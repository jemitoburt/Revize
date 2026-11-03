import {
  shouldApplyResult,
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
  site,
} from '../../db/schema.js';
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

export function createInspectionsService(db: Db) {
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
      return rows.map((r) => ({
        id: r.item.id,
        itemNumber: r.item.itemNumber,
        qrCode: r.item.qrCode,
        equipmentTypeId: r.item.equipmentTypeId,
        locationId: r.item.locationId,
        locationPath: r.pathIds ? pathNamesOf(r.pathIds, names) : [],
        fieldValues: r.item.fieldValues,
        status: r.item.status as ItemStatus,
        nextInspectionDate: r.item.nextInspectionDate,
        itemPhotoCount: r.itemPhotos,
        result: r.result
          ? {
              id: r.result.id,
              itemId: r.result.itemId,
              outcome: r.result.outcome as InspectionResult['outcome'],
              defectDescription: r.result.defectDescription,
              takenOutOfService: r.result.takenOutOfService,
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
        const values = {
          outcome: input.outcome,
          defectDescription: input.outcome === 'defect' ? input.defectDescription : null,
          takenOutOfService: input.outcome === 'defect' && input.takenOutOfService,
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
