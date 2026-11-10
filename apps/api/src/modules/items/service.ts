import {
  applyDefaultProducts,
  buildFieldValuesSchema,
  missingRequiredFields,
  canonicalItemNumber,
  designationOf,
  newId,
  normalizeDesignation,
  type Item,
  type ItemStatus,
  type bulkUpdateItemsSchema,
  type createItemSchema,
  type ItemDueFilter,
  type ItemHistoryEntry,
  type listItemsQuerySchema,
  type updateItemSchema,
} from '@revize/shared';
import { and, asc, count, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { equipmentType, item, location, site } from '../../db/schema.js';
import { AppError, notFound, validationError, versionConflict, type Issue } from '../../errors.js';
import { recordAudit } from '../audit/service.js';
import { locationNames, pathNamesOf } from '../locations/service.js';

type ItemRow = typeof item.$inferSelect;
type Joined = {
  item: ItemRow;
  typeName: string;
  typeFields: (typeof equipmentType.$inferSelect)['fieldDefinitions'];
  pathIds: string[] | null;
};

const numberTaken = () =>
  new AppError(409, 'item_number_taken', 'Toto číslo TZ už v evidenci existuje.', [
    { path: ['itemNumber'], message: 'Číslo TZ už má jiný artikl' },
  ]);
const designationTaken = () =>
  new AppError(409, 'designation_taken', 'Toto označení už v provozovně má jiný artikl.', [
    { path: ['designation'], message: 'Označení už v provozovně má jiný artikl' },
  ]);

const qrTaken = () =>
  new AppError(409, 'qr_code_taken', 'Tento QR kód už má jiný artikl.', [
    { path: ['qrCode'], message: 'QR kód už má jiný artikl' },
  ]);

function likePattern(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Item numbers sort numerically (shorter series first, ADR-0012). */
const numberOrder = [sql`length(${item.itemNumber})`, asc(item.itemNumber)];

const SORTS: Record<z.output<typeof listItemsQuerySchema>['sort'], SQL[]> = {
  location: [sql`${location.sortPath} asc nulls last`, ...numberOrder],
  itemNumber: numberOrder,
  type: [asc(equipmentType.name), sql`${location.sortPath} asc nulls last`, ...numberOrder],
  nextInspection: [sql`${item.nextInspectionDate} asc nulls last`, ...numberOrder],
  updated: [desc(item.updatedAt)],
};

/** Maps a unique violation (concurrent insert) to the same error as the explicit check. */
function mapUniqueViolation(error: unknown): never {
  const constraint =
    (error as { constraint?: string; cause?: { constraint?: string } }).constraint ??
    (error as { cause?: { constraint?: string } }).cause?.constraint;
  if (constraint === 'item_customer_number_key' || constraint === 'item_org_number_key')
    throw numberTaken();
  if (constraint === 'item_site_designation_key') throw designationTaken();
  if (constraint === 'item_org_qr_key') throw qrTaken();
  throw error;
}

/**
 * Filters by the inspection state (also used by the database export): next inspection overdue
 * or due within N days, and not checked in the last closed inspection of its site.
 */
export function itemStateFilters(query: {
  due?: ItemDueFilter | undefined;
  lastInspection?: 'unchecked' | undefined;
  incomplete?: boolean | undefined;
}): SQL[] {
  const filters: SQL[] = [];
  if (query.due === 'overdue') {
    filters.push(sql`${item.nextInspectionDate} < current_date`);
  } else if (query.due) {
    filters.push(sql`${item.nextInspectionDate} <= current_date + ${Number(query.due)}::int`);
  }
  if (query.incomplete) {
    // A required, not archived field of its type without a value.
    filters.push(sql`exists (
      select 1 from equipment_type t, jsonb_array_elements(t.field_definitions) f
      where t.id = "item"."equipment_type_id"
        and coalesce((f->>'required')::boolean, false)
        and not coalesce((f->>'archived')::boolean, false)
        and coalesce("item"."field_values"->>(f->>'key'), '') in ('', '[]')
    )`);
  }
  if (query.lastInspection === 'unchecked') {
    // The last closed inspection of the item's site that covered its type (no scope = all
    // types) and was closed after the item was created – without a result for the item.
    // Qualified names on purpose (see CLAUDE.md: correlated subqueries).
    filters.push(sql`exists (
      select 1 from (
        select i.id from inspection i
        where i.site_id = "item"."site_id" and i.status = 'closed'
          and i.closed_at >= "item"."created_at"
          and (not exists (select 1 from inspection_type_scope s where s.inspection_id = i.id)
            or exists (select 1 from inspection_type_scope s
              where s.inspection_id = i.id and s.equipment_type_id = "item"."equipment_type_id"))
        order by i.inspection_date desc, i.closed_at desc
        limit 1
      ) last
      where not exists (
        select 1 from inspection_result r where r.inspection_id = last.id and r.item_id = "item"."id"
      )
    )`);
  }
  return filters;
}

export function createItemsService(db: Db) {
  async function toDtos(tx: DbOrTx, rows: Joined[]): Promise<Item[]> {
    const names = await locationNames(
      tx,
      rows.flatMap((r) => r.pathIds ?? []),
    );
    return rows.map(({ item: row, typeName, typeFields, pathIds }) => ({
      id: row.id,
      customerId: row.customerId,
      siteId: row.siteId,
      locationId: row.locationId,
      locationPath: pathIds ? pathNamesOf(pathIds, names) : [],
      equipmentTypeId: row.equipmentTypeId,
      equipmentTypeName: typeName,
      itemNumber: row.itemNumber,
      designation: row.designation,
      qrCode: row.qrCode,
      fieldValues: row.fieldValues,
      status: row.status as ItemStatus,
      nextInspectionDate: row.nextInspectionDate,
      inspectionIntervalMonths: row.inspectionIntervalMonths,
      missingFields: missingRequiredFields(typeFields, row.fieldValues),
      retired: row.retiredAt !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    }));
  }

  const joined = (tx: DbOrTx) =>
    tx
      .select({
        item,
        typeName: equipmentType.name,
        typeFields: equipmentType.fieldDefinitions,
        pathIds: location.pathIds,
      })
      .from(item)
      .innerJoin(equipmentType, eq(equipmentType.id, item.equipmentTypeId))
      .leftJoin(location, eq(location.id, item.locationId));

  async function getJoined(tx: DbOrTx, auth: AuthContext, id: string): Promise<Joined> {
    const [row] = await joined(tx).where(
      and(eq(item.organizationId, auth.organizationId), eq(item.id, id)),
    );
    if (!row) throw notFound('Artikl neexistuje.');
    return row;
  }

  async function siteOf(tx: DbOrTx, auth: AuthContext, siteId: string) {
    const [row] = await tx
      .select()
      .from(site)
      .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, siteId)));
    if (!row) throw validationError([{ path: ['siteId'], message: 'Provozovna neexistuje' }]);
    return row;
  }

  async function typeOf(tx: DbOrTx, auth: AuthContext, typeId: string, allowArchived: boolean) {
    const [row] = await tx
      .select()
      .from(equipmentType)
      .where(
        and(eq(equipmentType.organizationId, auth.organizationId), eq(equipmentType.id, typeId)),
      );
    if (!row)
      throw validationError([{ path: ['equipmentTypeId'], message: 'Typ vybavení neexistuje' }]);
    if (row.archivedAt && !allowArchived) {
      throw validationError([
        { path: ['equipmentTypeId'], message: 'Typ vybavení je archivovaný' },
      ]);
    }
    return row;
  }

  async function checkLocation(
    tx: DbOrTx,
    auth: AuthContext,
    locationId: string | null,
    siteId: string,
  ) {
    if (locationId === null) return;
    const [row] = await tx
      .select()
      .from(location)
      .where(and(eq(location.organizationId, auth.organizationId), eq(location.id, locationId)));
    if (!row || row.siteId !== siteId) {
      throw validationError([
        { path: ['locationId'], message: 'Umístění nepatří do zvolené provozovny' },
      ]);
    }
    if (row.archivedAt)
      throw validationError([{ path: ['locationId'], message: 'Umístění je archivované' }]);
  }

  function validateValues(
    definitions: (typeof equipmentType.$inferSelect)['fieldDefinitions'],
    values: Record<string, unknown>,
  ) {
    // Empty fields with a default product (bay load) are filled like in the form and import.
    // Required fields may stay empty: the item is saved as incomplete (`missingFields`).
    const parsed = buildFieldValuesSchema(definitions, { allowMissing: true }).safeParse(
      applyDefaultProducts(definitions, values),
    );
    if (parsed.success) return parsed.data;
    const issues: Issue[] = parsed.error.issues.map((i) => ({
      path: ['fieldValues', ...i.path.map((p) => (typeof p === 'symbol' ? String(p) : p))],
      message: i.message,
    }));
    throw validationError(issues, issues[0]?.message);
  }

  function canonicalOrFail(input: string): string {
    const canonical = canonicalItemNumber(input);
    if (!canonical) {
      throw validationError([
        { path: ['itemNumber'], message: 'Číslo TZ: 4 nebo 5 číslic (úvodní nuly se nepočítají)' },
      ]);
    }
    return canonical;
  }

  async function assertUnique(
    tx: DbOrTx,
    auth: AuthContext,
    unique: {
      itemNumber: string | null;
      qrCode: string | null;
      /** Checked within this site when set. */
      designation?: { siteId: string; key: string | null };
    },
    exceptId?: string,
  ) {
    const { itemNumber, qrCode, designation } = unique;
    if (designation?.key) {
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(
          and(
            eq(item.siteId, designation.siteId),
            eq(item.designationKey, designation.key),
            isNull(item.retiredAt),
            exceptId ? ne(item.id, exceptId) : undefined,
          ),
        );
      if (row) throw designationTaken();
    }
    if (itemNumber) {
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(
          and(
            eq(item.organizationId, auth.organizationId),
            eq(item.itemNumber, itemNumber),
            exceptId ? ne(item.id, exceptId) : undefined,
          ),
        );
      if (row) throw numberTaken();
    }
    if (qrCode) {
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(
          and(
            eq(item.organizationId, auth.organizationId),
            eq(item.qrCode, qrCode),
            exceptId ? ne(item.id, exceptId) : undefined,
          ),
        );
      if (row) throw qrTaken();
    }
  }

  /** Next free číslo TZ of the organization (after the highest 4–5 digit number). */
  async function nextItemNumber(tx: DbOrTx, auth: AuthContext): Promise<string> {
    const [row] = await tx
      .select({ value: sql<string | null>`max(${item.itemNumber}::bigint)::text` })
      .from(item)
      .where(
        and(eq(item.organizationId, auth.organizationId), sql`length(${item.itemNumber}) <= 5`),
      );
    const next = Math.max(Number(row?.value ?? '0') + 1, 1000);
    if (next > 99_999) throw new AppError(409, 'numbers_exhausted', 'Došla čísla TZ.');
    return String(next);
  }

  const audit = (
    tx: DbOrTx,
    auth: AuthContext,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
    reason?: string,
  ) =>
    recordAudit(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action,
      entityType: 'item',
      entityId: id,
      before,
      after,
      ...(reason ? { reason } : {}),
    });

  /** Applies an update to one item inside a transaction (used by single and bulk updates). */
  async function applyUpdate(
    tx: DbOrTx,
    auth: AuthContext,
    current: ItemRow,
    input: Omit<z.output<typeof updateItemSchema>, 'version'>,
    version: number,
  ): Promise<ItemRow> {
    const siteId = input.siteId ?? current.siteId;
    if (input.siteId && input.siteId !== current.siteId) {
      const target = await siteOf(tx, auth, input.siteId);
      if (target.customerId !== current.customerId) {
        throw validationError([
          { path: ['siteId'], message: 'Provozovna patří jinému zákazníkovi' },
        ]);
      }
    }
    const locationId = input.locationId !== undefined ? input.locationId : current.locationId;
    if (input.locationId !== undefined || input.siteId !== undefined) {
      await checkLocation(tx, auth, locationId, siteId);
    }

    const typeId = input.equipmentTypeId ?? current.equipmentTypeId;
    const typeChanged = typeId !== current.equipmentTypeId;
    let fieldValues: Record<string, unknown> | undefined;
    if (input.fieldValues !== undefined || typeChanged) {
      const type = await typeOf(tx, auth, typeId, !typeChanged);
      fieldValues = validateValues(type.fieldDefinitions, input.fieldValues ?? current.fieldValues);
    }

    const itemNumber =
      input.itemNumber !== undefined ? canonicalOrFail(input.itemNumber) : undefined;
    const qrCode = input.qrCode !== undefined ? input.qrCode : undefined;
    const designation =
      input.designation !== undefined ? designationOf(input.designation) : undefined;
    const designationKey = designation ? designation.designationKey : current.designationKey;
    await assertUnique(
      tx,
      auth,
      {
        itemNumber: itemNumber ?? null,
        qrCode: qrCode ?? null,
        // Checked when it changes or the item moves to another site.
        ...(designation !== undefined || siteId !== current.siteId
          ? { designation: { siteId, key: designationKey } }
          : {}),
      },
      current.id,
    );

    const statusChanged = input.status !== undefined && input.status !== current.status;
    if (statusChanged && !input.reason) {
      throw validationError([{ path: ['reason'], message: 'Uveďte důvod změny stavu' }]);
    }

    const [row] = (await tx
      .update(item)
      .set({
        siteId: input.siteId,
        locationId: input.locationId,
        equipmentTypeId: input.equipmentTypeId,
        itemNumber,
        ...(designation ?? {}),
        qrCode,
        fieldValues,
        status: input.status,
        nextInspectionDate: input.nextInspectionDate,
        inspectionIntervalMonths: input.inspectionIntervalMonths,
        retiredAt:
          input.retired === undefined
            ? undefined
            : input.retired
              ? (current.retiredAt ?? new Date())
              : null,
        version: version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(item.id, current.id), eq(item.version, version)))
      .returning()
      .catch(mapUniqueViolation)) as ItemRow[];
    if (!row) throw versionConflict();
    const action = statusChanged
      ? 'item.status_change'
      : input.retired === true
        ? 'item.retire'
        : 'item.update';
    await audit(tx, auth, action, current.id, current, row, input.reason);
    return row;
  }

  return {
    /**
     * The item's history: every inspection of its site that covered its type since the item
     * exists (or that has a result for it), newest first, with the result or "not checked".
     */
    async history(auth: AuthContext, id: string): Promise<ItemHistoryEntry[]> {
      const [target] = await db
        .select()
        .from(item)
        .where(and(eq(item.organizationId, auth.organizationId), eq(item.id, id)));
      if (!target) throw notFound('Artikl neexistuje.');
      const rows = await db.execute<{
        inspection_id: string;
        inspection_date: string;
        status: 'open' | 'closed';
        outcome: 'ok' | 'defect' | null;
        severity: 'green' | 'amber' | 'red' | null;
        taken_out_of_service: boolean | null;
        defect_description: string | null;
        recorded_by_name: string | null;
        recorded_at: Date | string | null;
        photo_count: number | null;
      }>(sql`
        select i.id as inspection_id, i.inspection_date::text as inspection_date, i.status,
          r.outcome, r.severity, r.taken_out_of_service, r.defect_description,
          u.display_name as recorded_by_name, r.recorded_at,
          (select count(*)::int from photo p where p.inspection_result_id = r.id) as photo_count
        from inspection i
        left join inspection_result r on r.inspection_id = i.id and r.item_id = ${id}
        left join app_user u on u.id = r.recorded_by
        where i.organization_id = ${auth.organizationId}
          and (r.id is not null or (
            i.site_id = ${target.siteId}
            and i.created_at >= ${target.createdAt.toISOString()}::timestamptz
            and (not exists (select 1 from inspection_type_scope s where s.inspection_id = i.id)
              or exists (select 1 from inspection_type_scope s
                where s.inspection_id = i.id and s.equipment_type_id = ${target.equipmentTypeId}))))
        order by i.inspection_date desc, i.created_at desc`);
      return rows.rows.map((r) => ({
        inspectionId: r.inspection_id,
        inspectionDate: r.inspection_date,
        inspectionStatus: r.status,
        result: r.outcome
          ? {
              outcome: r.outcome,
              severity: r.severity,
              takenOutOfService: r.taken_out_of_service ?? false,
              defectDescription: r.defect_description,
              recordedByName: r.recorded_by_name ?? '?',
              recordedAt: new Date(r.recorded_at!).toISOString(),
              photoCount: r.photo_count ?? 0,
            }
          : null,
      }));
    },

    async list(
      auth: AuthContext,
      query: z.output<typeof listItemsQuerySchema>,
    ): Promise<{ items: Item[]; total: number }> {
      const filters: SQL[] = [eq(item.organizationId, auth.organizationId)];
      if (query.customerId) filters.push(eq(item.customerId, query.customerId));
      if (query.siteId) filters.push(eq(item.siteId, query.siteId));
      if (query.equipmentTypeId) filters.push(eq(item.equipmentTypeId, query.equipmentTypeId));
      if (query.status) filters.push(eq(item.status, query.status));
      if (!query.includeRetired) filters.push(isNull(item.retiredAt));
      filters.push(...itemStateFilters(query));
      if (query.locationId)
        filters.push(sql`${location.pathIds} @> array[${query.locationId}]::uuid[]`);
      if (query.q) {
        const pattern = `%${likePattern(query.q)}%`;
        const number = canonicalItemNumber(query.q);
        filters.push(
          sql`(${number ? sql`${item.itemNumber} like ${`${number}%`} or ` : sql``}${item.qrCode} ilike ${pattern} or ${item.designation} ilike ${pattern} or ${item.designationKey} like ${`%${likePattern(normalizeDesignation(query.q))}%`} or ${item.fieldValues}::text ilike ${pattern})`,
        );
      }
      const where = and(...filters);
      const [rows, [total]] = await Promise.all([
        joined(db)
          .where(where)
          .orderBy(...SORTS[query.sort])
          .limit(query.limit)
          .offset(query.offset),
        db
          .select({ value: count() })
          .from(item)
          .leftJoin(location, eq(location.id, item.locationId))
          .where(where),
      ]);
      return { items: await toDtos(db, rows), total: total?.value ?? 0 };
    },

    async get(auth: AuthContext, id: string): Promise<Item> {
      return (await toDtos(db, [await getJoined(db, auth, id)]))[0]!;
    },

    async create(auth: AuthContext, input: z.output<typeof createItemSchema>): Promise<Item> {
      const id = input.id ?? newId();
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: item.id, org: item.organizationId })
          .from(item)
          .where(eq(item.id, id));
        if (existing) {
          if (existing.org !== auth.organizationId)
            throw new AppError(409, 'id_taken', 'ID je již použito.');
          return; // repeated request with the same client id (ADR-0004)
        }
        const targetSite = await siteOf(tx, auth, input.siteId);
        if (targetSite.archivedAt)
          throw validationError([{ path: ['siteId'], message: 'Provozovna je archivovaná' }]);
        const type = await typeOf(tx, auth, input.equipmentTypeId, false);
        await checkLocation(tx, auth, input.locationId, input.siteId);
        const fieldValues = validateValues(type.fieldDefinitions, input.fieldValues);
        const itemNumber = input.itemNumber
          ? canonicalOrFail(input.itemNumber)
          : await nextItemNumber(tx, auth);
        const designation = designationOf(input.designation);
        await assertUnique(tx, auth, {
          itemNumber,
          qrCode: input.qrCode ?? null,
          designation: { siteId: input.siteId, key: designation.designationKey },
        });

        const created = await tx
          .insert(item)
          .values({
            id,
            organizationId: auth.organizationId,
            customerId: targetSite.customerId,
            siteId: input.siteId,
            locationId: input.locationId,
            equipmentTypeId: input.equipmentTypeId,
            itemNumber,
            ...designation,
            qrCode: input.qrCode ?? null,
            fieldValues,
            nextInspectionDate: input.nextInspectionDate ?? null,
            inspectionIntervalMonths: input.inspectionIntervalMonths ?? null,
            createdBy: auth.userId,
          })
          .returning()
          .catch(mapUniqueViolation);
        await audit(tx, auth, 'item.create', id, null, created[0]);
      });
      return this.get(auth, id);
    },

    async update(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateItemSchema>,
    ): Promise<Item> {
      await db.transaction(async (tx) => {
        const { item: current } = await getJoined(tx, auth, id);
        if (input.version !== undefined && current.version !== input.version) {
          throw versionConflict();
        }
        const { version = current.version, ...changes } = input;
        await applyUpdate(tx, auth, current, changes, version);
      });
      return this.get(auth, id);
    },

    /** Same change for many items in one transaction (all or nothing). */
    async bulkUpdate(
      auth: AuthContext,
      input: z.output<typeof bulkUpdateItemsSchema>,
    ): Promise<{ updated: number }> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(item)
          .where(and(eq(item.organizationId, auth.organizationId), inArray(item.id, input.ids)));
        if (rows.length !== new Set(input.ids).size) throw notFound('Některé artikly neexistují.');
        for (const current of rows) {
          await applyUpdate(
            tx,
            auth,
            current,
            { ...input.set, reason: input.reason },
            current.version,
          );
        }
        return { updated: rows.length };
      });
    },
  };
}

export type ItemsService = ReturnType<typeof createItemsService>;
