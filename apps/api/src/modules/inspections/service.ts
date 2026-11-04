import {
  type ClosePreview,
  inspectionIntervalOf,
  nextInspectionDateOf,
  shouldApplyResult,
  type closeInspectionSchema,
  type Inspection,
  type InspectionItem,
  type InspectionProgress,
  type InspectionResult,
  type ItemStatus,
  type listInspectionsQuerySchema,
  type recordResultSchema,
  type startInspectionSchema,
} from '@revize/shared';
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import {
  appUser,
  customer,
  equipmentType,
  inspection,
  inspectionInspector,
  inspectionResult,
  inspectionTypeScope,
  item,
  location,
  photo,
  site,
} from '../../db/schema.js';
import type { FileStorage } from '../../infra/file-storage.js';
import { organizationOf, settingsOf } from '../organization/service.js';
import { AppError, conflict, notFound, validationError } from '../../errors.js';
import { recordAudit } from '../audit/service.js';
import { locationNames, pathNamesOf } from '../locations/service.js';

type InspectionRow = typeof inspection.$inferSelect;
type ResultRow = typeof inspectionResult.$inferSelect;

export const inspectionClosed = () =>
  conflict('inspection_closed', 'Kontrola je uzavřená, výsledky už nelze měnit.');

const lead = aliasedTable(appUser, 'lead');
const recorder = aliasedTable(appUser, 'recorder');

/** Item numbers sort numerically (shorter series first, ADR-0012). */
const numberOrder = [sql`length(${item.itemNumber})`, asc(item.itemNumber)];

/** Locks the inspection row of the caller's organization for the rest of the transaction. */
export async function lockInspection(
  tx: DbOrTx,
  auth: AuthContext,
  id: string,
): Promise<InspectionRow> {
  const [row] = await tx
    .select()
    .from(inspection)
    .where(and(eq(inspection.organizationId, auth.organizationId), eq(inspection.id, id)))
    .for('update');
  if (!row) throw notFound('Kontrola neexistuje.');
  return row;
}

async function scopeOf(tx: DbOrTx, inspectionId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: inspectionTypeScope.equipmentTypeId })
    .from(inspectionTypeScope)
    .where(eq(inspectionTypeScope.inspectionId, inspectionId));
  return rows.map((r) => r.id);
}

/** Items the inspection covers: the site's items (of the chosen types) still in the records. */
function inScope(row: InspectionRow, types: string[]): SQL {
  return and(
    eq(item.siteId, row.siteId),
    isNull(item.retiredAt),
    types.length > 0 ? inArray(item.equipmentTypeId, types) : undefined,
  )!;
}

/**
 * The interval that applies to each item (months): its own, else the nearest location's
 * (`path_ids` runs from the top level down to the item's location), else the site's, else the
 * type's default (`inspectionIntervalOf`).
 */
export async function effectiveIntervals(
  tx: DbOrTx,
  items: readonly {
    id: string;
    siteId: string;
    equipmentTypeId: string;
    inspectionIntervalMonths: number | null;
    pathIds: readonly string[] | null;
  }[],
): Promise<Map<string, number>> {
  const locationIds = [...new Set(items.flatMap((i) => i.pathIds ?? []))];
  const siteIds = [...new Set(items.map((i) => i.siteId))];
  const typeIds = [...new Set(items.map((i) => i.equipmentTypeId))];
  const [locations, sites, types] = await Promise.all([
    locationIds.length
      ? tx
          .select({ id: location.id, months: location.inspectionIntervalMonths })
          .from(location)
          .where(inArray(location.id, locationIds))
      : [],
    siteIds.length
      ? tx
          .select({ id: site.id, months: site.inspectionIntervalMonths })
          .from(site)
          .where(inArray(site.id, siteIds))
      : [],
    typeIds.length
      ? tx
          .select({ id: equipmentType.id, months: equipmentType.defaultIntervalMonths })
          .from(equipmentType)
          .where(inArray(equipmentType.id, typeIds))
      : [],
  ]);
  const byLocation = new Map(locations.map((l) => [l.id, l.months]));
  const bySite = new Map(sites.map((x) => [x.id, x.months]));
  const byType = new Map(types.map((t) => [t.id, t.months]));
  return new Map(
    items.map((i) => [
      i.id,
      inspectionIntervalOf(
        i.inspectionIntervalMonths,
        [...(i.pathIds ?? [])].reverse().map((id) => byLocation.get(id)),
        bySite.get(i.siteId),
        byType.get(i.equipmentTypeId) ?? 12,
      ),
    ]),
  );
}

export function createInspectionsService(db: Db, files?: FileStorage) {
  /**
   * Defect photos of earlier closed inspections (same or earlier date) of the items that have a
   * result in this inspection – replaced by this inspection's photos when it is closed.
   */
  async function previousDefectPhotos(tx: DbOrTx, auth: AuthContext, row: InspectionRow) {
    return tx
      .select({ id: photo.id, storageKey: photo.storageKey, thumbnailKey: photo.thumbnailKey })
      .from(photo)
      .innerJoin(inspectionResult, eq(inspectionResult.id, photo.inspectionResultId))
      .innerJoin(inspection, eq(inspection.id, inspectionResult.inspectionId))
      .where(
        and(
          eq(photo.organizationId, auth.organizationId),
          sql`${inspection.id} <> ${row.id}`,
          eq(inspection.status, 'closed'),
          sql`${inspection.inspectionDate} <= ${row.inspectionDate}`,
          sql`${inspectionResult.itemId} in (select r.item_id from inspection_result r where r.inspection_id = ${row.id})`,
        ),
      );
  }

  async function progressOf(tx: DbOrTx, ids: string[]): Promise<Map<string, InspectionProgress>> {
    if (ids.length === 0) return new Map();
    // Raw SQL with explicit aliases: the scope subqueries refer to the outer inspection.
    const { rows } = await tx.execute<{
      id: string;
      total: number;
      checked: number;
      ok: number;
      defect: number;
      out_of_service: number;
    }>(sql`
      select i.id,
        count(it.id)::int as total,
        count(r.id)::int as checked,
        (count(r.id) filter (where r.outcome = 'ok'))::int as ok,
        (count(r.id) filter (where r.outcome = 'defect'))::int as defect,
        (count(r.id) filter (where r.taken_out_of_service))::int as out_of_service
      from inspection i
      left join item it on it.site_id = i.site_id and it.retired_at is null and (
        not exists (select 1 from inspection_type_scope s where s.inspection_id = i.id)
        or exists (select 1 from inspection_type_scope s
                   where s.inspection_id = i.id and s.equipment_type_id = it.equipment_type_id))
      left join inspection_result r on r.inspection_id = i.id and r.item_id = it.id
      where i.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      group by i.id`);
    return new Map(
      rows.map((r) => [
        r.id,
        {
          total: r.total,
          checked: r.checked,
          ok: r.ok,
          defect: r.defect,
          outOfService: r.out_of_service,
        },
      ]),
    );
  }

  async function toDtos(
    tx: DbOrTx,
    rows: {
      inspection: InspectionRow;
      customerName: string;
      siteName: string;
      leadName: string;
    }[],
  ): Promise<Inspection[]> {
    const ids = rows.map((r) => r.inspection.id);
    if (ids.length === 0) return [];
    const [progress, inspectors, scopes] = await Promise.all([
      progressOf(tx, ids),
      tx
        .select({
          inspectionId: inspectionInspector.inspectionId,
          id: appUser.id,
          displayName: appUser.displayName,
        })
        .from(inspectionInspector)
        .innerJoin(appUser, eq(appUser.id, inspectionInspector.userId))
        .where(inArray(inspectionInspector.inspectionId, ids))
        .orderBy(asc(appUser.displayName)),
      tx.select().from(inspectionTypeScope).where(inArray(inspectionTypeScope.inspectionId, ids)),
    ]);
    return rows.map(({ inspection: row, customerName, siteName, leadName }) => ({
      id: row.id,
      customerId: row.customerId,
      customerName,
      siteId: row.siteId,
      siteName,
      leadInspectorId: row.leadInspectorId,
      leadInspectorName: leadName,
      inspectors: inspectors
        .filter((i) => i.inspectionId === row.id)
        .map(({ id, displayName }) => ({ id, displayName })),
      equipmentTypeIds: scopes
        .filter((s) => s.inspectionId === row.id)
        .map((s) => s.equipmentTypeId),
      inspectionDate: row.inspectionDate,
      nextInspectionDate: row.nextInspectionDate,
      status: row.status as Inspection['status'],
      note: row.note,
      progress: progress.get(row.id) ?? { total: 0, checked: 0, ok: 0, defect: 0, outOfService: 0 },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    }));
  }

  const joined = (tx: DbOrTx) =>
    tx
      .select({
        inspection,
        customerName: customer.name,
        siteName: site.name,
        leadName: lead.displayName,
      })
      .from(inspection)
      .innerJoin(customer, eq(customer.id, inspection.customerId))
      .innerJoin(site, eq(site.id, inspection.siteId))
      .innerJoin(lead, eq(lead.id, inspection.leadInspectorId));

  async function get(tx: DbOrTx, auth: AuthContext, id: string): Promise<Inspection> {
    const rows = await joined(tx).where(
      and(eq(inspection.organizationId, auth.organizationId), eq(inspection.id, id)),
    );
    if (rows.length === 0) throw notFound('Kontrola neexistuje.');
    return (await toDtos(tx, rows))[0]!;
  }

  async function addInspector(tx: DbOrTx, inspectionId: string, userId: string) {
    await tx.insert(inspectionInspector).values({ inspectionId, userId }).onConflictDoNothing();
  }

  async function resultDto(tx: DbOrTx, row: ResultRow): Promise<InspectionResult> {
    const [extra] = await tx
      .select({
        name: appUser.displayName,
        photos: sql<number>`(select count(*)::int from photo p where p.inspection_result_id = ${row.id})`,
      })
      .from(appUser)
      .where(eq(appUser.id, row.recordedBy));
    return {
      id: row.id,
      itemId: row.itemId,
      outcome: row.outcome as InspectionResult['outcome'],
      defectDescription: row.defectDescription,
      takenOutOfService: row.takenOutOfService,
      severity: row.severity as InspectionResult['severity'],
      includeInProtocol: row.includeInProtocol,
      photosInProtocol: row.photosInProtocol,
      recordedAt: row.recordedAt.toISOString(),
      recordedBy: row.recordedBy,
      recordedByName: extra?.name ?? '?',
      photoCount: extra?.photos ?? 0,
      version: row.version,
    };
  }

  const audit = (
    tx: DbOrTx,
    auth: AuthContext,
    action: string,
    entityType: string,
    id: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ) =>
    recordAudit(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action,
      entityType,
      entityId: id,
      before,
      after,
      ...(reason ? { reason } : {}),
    });

  return {
    get: (auth: AuthContext, id: string) => get(db, auth, id),

    async list(
      auth: AuthContext,
      query: z.output<typeof listInspectionsQuerySchema>,
    ): Promise<Inspection[]> {
      const rows = await joined(db)
        .where(
          and(
            eq(inspection.organizationId, auth.organizationId),
            query.status ? eq(inspection.status, query.status) : undefined,
            query.siteId ? eq(inspection.siteId, query.siteId) : undefined,
            query.customerId ? eq(inspection.customerId, query.customerId) : undefined,
          ),
        )
        .orderBy(desc(inspection.inspectionDate), desc(inspection.createdAt))
        .limit(200);
      return toDtos(db, rows);
    },

    /** Starts an inspection under the client's id; repeating the request returns it unchanged. */
    async start(
      auth: AuthContext,
      id: string,
      input: z.output<typeof startInspectionSchema>,
    ): Promise<{ created: boolean; inspection: Inspection }> {
      const created = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ org: inspection.organizationId })
          .from(inspection)
          .where(eq(inspection.id, id));
        if (existing) {
          if (existing.org !== auth.organizationId)
            throw new AppError(409, 'id_taken', 'ID je již použito.');
          return false;
        }
        const [targetSite] = await tx
          .select()
          .from(site)
          .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, input.siteId)));
        if (!targetSite || targetSite.archivedAt) {
          throw validationError([{ path: ['siteId'], message: 'Provozovna neexistuje' }]);
        }
        const types = [...new Set(input.equipmentTypeIds)];
        if (types.length > 0) {
          const found = await tx
            .select({ id: equipmentType.id })
            .from(equipmentType)
            .where(
              and(
                eq(equipmentType.organizationId, auth.organizationId),
                inArray(equipmentType.id, types),
              ),
            );
          if (found.length !== types.length) {
            throw validationError([
              { path: ['equipmentTypeIds'], message: 'Typ vybavení neexistuje' },
            ]);
          }
        }
        const [row] = await tx
          .insert(inspection)
          .values({
            id,
            organizationId: auth.organizationId,
            customerId: targetSite.customerId,
            siteId: targetSite.id,
            leadInspectorId: auth.userId,
            inspectionDate: input.inspectionDate,
            note: input.note || null,
          })
          .returning();
        await addInspector(tx, id, auth.userId);
        if (types.length > 0) {
          await tx
            .insert(inspectionTypeScope)
            .values(types.map((equipmentTypeId) => ({ inspectionId: id, equipmentTypeId })));
        }
        await audit(tx, auth, 'inspection.start', 'inspection', id, null, {
          ...row,
          equipmentTypeIds: types,
        });
        return true;
      });
      return { created, inspection: await get(db, auth, id) };
    },

    /** Another technician joins the inspection (also happens on their first result). */
    async join(auth: AuthContext, id: string): Promise<Inspection> {
      await db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, id);
        if (row.status === 'closed') throw inspectionClosed();
        await addInspector(tx, id, auth.userId);
      });
      return get(db, auth, id);
    },

    /** The technician's working list, sorted by location and item number. */
    async items(auth: AuthContext, id: string): Promise<InspectionItem[]> {
      const [row] = await db
        .select()
        .from(inspection)
        .where(and(eq(inspection.organizationId, auth.organizationId), eq(inspection.id, id)));
      if (!row) throw notFound('Kontrola neexistuje.');
      const types = await scopeOf(db, id);
      const rows = await db
        .select({
          item,
          pathIds: location.pathIds,
          result: inspectionResult,
          recordedByName: recorder.displayName,
          itemPhotos: sql<number>`(select count(*)::int from photo p where p.item_id = "item"."id")`,
          resultPhotos: sql<number>`(select count(*)::int from photo p where p.inspection_result_id = "inspection_result"."id")`,
        })
        .from(item)
        .leftJoin(location, eq(location.id, item.locationId))
        .leftJoin(
          inspectionResult,
          and(eq(inspectionResult.inspectionId, id), eq(inspectionResult.itemId, item.id)),
        )
        .leftJoin(recorder, eq(recorder.id, inspectionResult.recordedBy))
        .where(and(eq(item.organizationId, auth.organizationId), inScope(row, types)))
        .orderBy(sql`${location.sortPath} asc nulls last`, ...numberOrder);
      const names = await locationNames(
        db,
        rows.flatMap((r) => r.pathIds ?? []),
      );
      const intervals = await effectiveIntervals(
        db,
        rows.map((r) => ({ ...r.item, pathIds: r.pathIds })),
      );
      return rows.map((r) => ({
        id: r.item.id,
        itemNumber: r.item.itemNumber,
        designation: r.item.designation,
        qrCode: r.item.qrCode,
        equipmentTypeId: r.item.equipmentTypeId,
        locationId: r.item.locationId,
        locationPath: r.pathIds ? pathNamesOf(r.pathIds, names) : [],
        fieldValues: r.item.fieldValues,
        status: r.item.status as ItemStatus,
        nextInspectionDate: r.item.nextInspectionDate,
        itemPhotoCount: r.itemPhotos,
        intervalMonths: intervals.get(r.item.id) ?? 12,
        result: r.result
          ? {
              id: r.result.id,
              itemId: r.result.itemId,
              outcome: r.result.outcome as InspectionResult['outcome'],
              defectDescription: r.result.defectDescription,
              takenOutOfService: r.result.takenOutOfService,
              severity: r.result.severity as InspectionResult['severity'],
              includeInProtocol: r.result.includeInProtocol,
              photosInProtocol: r.result.photosInProtocol,
              recordedAt: r.result.recordedAt.toISOString(),
              recordedBy: r.result.recordedBy,
              recordedByName: r.recordedByName ?? '?',
              photoCount: r.resultPhotos,
              version: r.result.version,
            }
          : null,
      }));
    },

    /**
     * Records the result of one item. Idempotent; when the item already has a result, the one
     * recorded later on the device wins (ADR-0004) and the overruled one is audited.
     */
    async recordResult(
      auth: AuthContext,
      inspectionId: string,
      itemId: string,
      input: z.output<typeof recordResultSchema>,
    ): Promise<InspectionResult> {
      return db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, inspectionId);
        if (row.status === 'closed') throw inspectionClosed();
        const types = await scopeOf(tx, inspectionId);
        const [target] = await tx
          .select()
          .from(item)
          .where(
            and(
              eq(item.organizationId, auth.organizationId),
              eq(item.id, itemId),
              inScope(row, types),
            ),
          );
        if (!target) {
          throw conflict('item_out_of_scope', 'Artikl do této kontroly nepatří.');
        }
        await addInspector(tx, inspectionId, auth.userId);

        const recordedAt = new Date(input.recordedAt);
        // Types without the risk levels of ČSN EN 15635: a defect either does not prevent safe
        // operation (stored as green, stays in use) or it does (unfit, stored as red: out of
        // service). Both are always in the protocol.
        const [targetType] = await tx
          .select({ riskLevels: equipmentType.riskLevels })
          .from(equipmentType)
          .where(eq(equipmentType.id, target.equipmentTypeId));
        const fitUnfit = input.outcome === 'defect' && targetType?.riskLevels === false;
        const severity = fitUnfit
          ? input.severity === 'green'
            ? ('green' as const)
            : ('red' as const)
          : input.severity;
        const values = {
          outcome: input.outcome,
          defectDescription: input.outcome === 'defect' ? input.defectDescription : null,
          takenOutOfService: fitUnfit ? severity === 'red' : input.takenOutOfService,
          severity,
          includeInProtocol: fitUnfit || input.includeInProtocol,
          photosInProtocol: input.photosInProtocol,
          recordedAt,
          recordedBy: auth.userId,
        };
        const [existing] = await tx
          .select()
          .from(inspectionResult)
          .where(
            and(
              eq(inspectionResult.inspectionId, inspectionId),
              eq(inspectionResult.itemId, itemId),
            ),
          )
          .for('update');

        let saved: ResultRow | undefined;
        if (existing) {
          if (!shouldApplyResult(existing.recordedAt, recordedAt)) {
            await audit(
              tx,
              auth,
              'inspection.result_overruled',
              'inspection_result',
              existing.id,
              null,
              {
                ...values,
                id: input.id,
              },
            );
            return resultDto(tx, existing);
          }
          const unchanged =
            existing.outcome === values.outcome &&
            existing.defectDescription === values.defectDescription &&
            existing.takenOutOfService === values.takenOutOfService &&
            existing.severity === values.severity &&
            existing.includeInProtocol === values.includeInProtocol &&
            existing.photosInProtocol === values.photosInProtocol &&
            existing.recordedAt.getTime() === recordedAt.getTime() &&
            existing.recordedBy === auth.userId;
          if (unchanged) return resultDto(tx, existing);
          [saved] = await tx
            .update(inspectionResult)
            .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
            .where(eq(inspectionResult.id, existing.id))
            .returning();
          await audit(
            tx,
            auth,
            'inspection.result_update',
            'inspection_result',
            existing.id,
            existing,
            saved,
          );
        } else {
          const [taken] = await tx
            .select({ id: inspectionResult.id })
            .from(inspectionResult)
            .where(eq(inspectionResult.id, input.id));
          if (taken) throw new AppError(409, 'id_taken', 'ID je již použito.');
          [saved] = await tx
            .insert(inspectionResult)
            .values({
              id: input.id,
              organizationId: auth.organizationId,
              inspectionId,
              itemId,
              ...values,
            })
            .returning();
          await audit(tx, auth, 'inspection.result', 'inspection_result', input.id, null, saved);
        }

        // Taking out of service changes the item at once; returning it to service is an
        // audited decision of the office (item edit with a reason).
        if (saved!.takenOutOfService && target.status === 'in_service') {
          const [updated] = await tx
            .update(item)
            .set({ status: 'out_of_service', version: target.version + 1, updatedAt: new Date() })
            .where(eq(item.id, itemId))
            .returning();
          await audit(
            tx,
            auth,
            'item.status',
            'item',
            itemId,
            target,
            updated,
            'Vyřazeno z provozu při kontrole',
          );
        }
        return resultDto(tx, saved!);
      });
    },

    /**
     * Closes the inspection (office): results become read-only and every checked item gets its
     * next inspection date – the one given for the inspection, or date + the type's interval.
     */
    async close(
      auth: AuthContext,
      id: string,
      input: z.output<typeof closeInspectionSchema>,
    ): Promise<Inspection> {
      const pruned = await db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, id);
        if (row.status === 'closed')
          throw conflict('inspection_closed', 'Kontrola už je uzavřená.');
        // The defect photos of earlier inspections of these items are replaced by this one's
        // (backed up outside through the photo ZIP), unless switched off in Nastavení.
        let previous: Awaited<ReturnType<typeof previousDefectPhotos>> = [];
        if (settingsOf(await organizationOf(tx, auth)).deletePreviousDefectPhotos) {
          previous = await previousDefectPhotos(tx, auth, row);
          if (previous.length) {
            await tx.delete(photo).where(
              inArray(
                photo.id,
                previous.map((p) => p.id),
              ),
            );
            await audit(
              tx,
              auth,
              'photo.delete_previous_defect_photos',
              'inspection',
              id,
              { photoIds: previous.map((p) => p.id) },
              null,
              'Uzavření kontroly: fotky závad z předchozích kontrol',
            );
          }
        }
        const checked = await tx
          .select({ item, pathIds: location.pathIds })
          .from(inspectionResult)
          .innerJoin(item, eq(item.id, inspectionResult.itemId))
          .leftJoin(location, eq(location.id, item.locationId))
          .where(eq(inspectionResult.inspectionId, id));
        // Each item by its own interval (item → location → site → type).
        const intervals = await effectiveIntervals(
          tx,
          checked.map((c) => ({ ...c.item, pathIds: c.pathIds })),
        );
        const dates: string[] = [];
        for (const { item: target } of checked) {
          const interval = intervals.get(target.id) ?? 12;
          const next = nextInspectionDateOf(row.inspectionDate, interval, input.nextInspectionDate);
          dates.push(next);
          if (target.nextInspectionDate === next) continue;
          await tx
            .update(item)
            .set({ nextInspectionDate: next, version: target.version + 1, updatedAt: new Date() })
            .where(eq(item.id, target.id));
          await audit(
            tx,
            auth,
            'item.next_inspection',
            'item',
            target.id,
            { nextInspectionDate: target.nextInspectionDate },
            { nextInspectionDate: next },
            'Uzavření kontroly',
          );
        }
        const nextForInspection =
          input.nextInspectionDate ?? (dates.length ? dates.sort()[0]! : null);
        const [closed] = await tx
          .update(inspection)
          .set({
            status: 'closed',
            closedAt: new Date(),
            closedBy: auth.userId,
            nextInspectionDate: nextForInspection,
            note: input.note === undefined ? row.note : input.note || null,
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inspection.id, id))
          .returning();
        await audit(tx, auth, 'inspection.close', 'inspection', id, row, {
          ...closed,
          checkedItems: checked.length,
        });
        return previous;
      });
      // Files after the commit: a failed close keeps them.
      for (const p of pruned) {
        await files?.delete(p.storageKey);
        if (p.thumbnailKey) await files?.delete(p.thumbnailKey);
      }
      return get(db, auth, id);
    },

    /** What closing would delete (shown in the close dialog). */
    async closePreview(auth: AuthContext, id: string): Promise<ClosePreview> {
      const [row] = await db
        .select()
        .from(inspection)
        .where(and(eq(inspection.organizationId, auth.organizationId), eq(inspection.id, id)));
      if (!row) throw notFound('Kontrola neexistuje.');
      const deletes = settingsOf(await organizationOf(db, auth)).deletePreviousDefectPhotos;
      return {
        previousDefectPhotos: (await previousDefectPhotos(db, auth, row)).length,
        deletesPreviousDefectPhotos: deletes,
      };
    },

    /** Opens a closed inspection again (audited with the reason, ADR-0011). */
    async reopen(auth: AuthContext, id: string, reason: string): Promise<Inspection> {
      await db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, id);
        if (row.status === 'open') throw conflict('inspection_open', 'Kontrola je otevřená.');
        const [opened] = await tx
          .update(inspection)
          .set({
            status: 'open',
            closedAt: null,
            closedBy: null,
            reopenedCount: row.reopenedCount + 1,
            version: row.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inspection.id, id))
          .returning();
        await audit(tx, auth, 'inspection.reopen', 'inspection', id, row, opened, reason);
      });
      return get(db, auth, id);
    },

    /** Office: print the defect photos of one result in the protocol or not (audited). */
    async setPhotosInProtocol(
      auth: AuthContext,
      inspectionId: string,
      itemId: string,
      photosInProtocol: boolean,
    ): Promise<InspectionResult> {
      return db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, inspectionId);
        if (row.status === 'closed') throw inspectionClosed();
        const [existing] = await tx
          .select()
          .from(inspectionResult)
          .where(
            and(
              eq(inspectionResult.inspectionId, inspectionId),
              eq(inspectionResult.itemId, itemId),
            ),
          )
          .for('update');
        if (!existing) throw notFound('Artikl v této kontrole nemá výsledek.');
        if (existing.photosInProtocol === photosInProtocol) return resultDto(tx, existing);
        const [saved] = await tx
          .update(inspectionResult)
          .set({ photosInProtocol, version: existing.version + 1, updatedAt: new Date() })
          .where(eq(inspectionResult.id, existing.id))
          .returning();
        await audit(
          tx,
          auth,
          'inspection.result_photos_in_protocol',
          'inspection_result',
          existing.id,
          { photosInProtocol: existing.photosInProtocol },
          { photosInProtocol },
        );
        return resultDto(tx, saved!);
      });
    },

    /** Back to "not checked". Defect photos have to be deleted first. */
    async deleteResult(auth: AuthContext, inspectionId: string, itemId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const row = await lockInspection(tx, auth, inspectionId);
        if (row.status === 'closed') throw inspectionClosed();
        const [existing] = await tx
          .select()
          .from(inspectionResult)
          .where(
            and(
              eq(inspectionResult.inspectionId, inspectionId),
              eq(inspectionResult.itemId, itemId),
            ),
          )
          .for('update');
        if (!existing) return;
        const [photos] = await tx
          .execute<{ count: number }>(
            sql`select count(*)::int as count from photo where inspection_result_id = ${existing.id}`,
          )
          .then((r) => r.rows);
        if ((photos?.count ?? 0) > 0) {
          throw conflict('result_has_photos', 'Nejdřív smažte fotky závady.');
        }
        await tx.delete(inspectionResult).where(eq(inspectionResult.id, existing.id));
        await audit(
          tx,
          auth,
          'inspection.result_delete',
          'inspection_result',
          existing.id,
          existing,
          null,
        );
      });
    },
  };
}

export type InspectionsService = ReturnType<typeof createInspectionsService>;
