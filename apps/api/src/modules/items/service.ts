import {
  applyDefaultProducts,
  buildFieldValuesSchema,
  canonicalItemNumber,
  newId,
  type Item,
  type ItemStatus,
  type bulkUpdateItemsSchema,
  type createItemSchema,
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
type Joined = { item: ItemRow; typeName: string; pathIds: string[] | null };

const numberTaken = () =>
  new AppError(409, 'item_number_taken', 'Toto číslo artiklu už u zákazníka existuje.', [
    { path: ['itemNumber'], message: 'Číslo už má jiný artikl' },
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
  if (constraint === 'item_customer_number_key') throw numberTaken();
  if (constraint === 'item_org_qr_key') throw qrTaken();
  throw error;
}

export function createItemsService(db: Db) {
  async function toDtos(tx: DbOrTx, rows: Joined[]): Promise<Item[]> {
    const names = await locationNames(
      tx,
      rows.flatMap((r) => r.pathIds ?? []),
    );
    return rows.map(({ item: row, typeName, pathIds }) => ({
      id: row.id,
      customerId: row.customerId,
      siteId: row.siteId,
      locationId: row.locationId,
      locationPath: pathIds ? pathNamesOf(pathIds, names) : [],
      equipmentTypeId: row.equipmentTypeId,
      equipmentTypeName: typeName,
      itemNumber: row.itemNumber,
      qrCode: row.qrCode,
      fieldValues: row.fieldValues,
      status: row.status as ItemStatus,
      nextInspectionDate: row.nextInspectionDate,
      retired: row.retiredAt !== null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    }));
  }

  const joined = (tx: DbOrTx) =>
    tx
      .select({ item, typeName: equipmentType.name, pathIds: location.pathIds })
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
    const parsed = buildFieldValuesSchema(definitions).safeParse(
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
        { path: ['itemNumber'], message: 'Číslo artiklu: 1–8 číslic (úvodní nuly se nepočítají)' },
      ]);
    }
    return canonical;
  }

  async function assertUnique(
    tx: DbOrTx,
    auth: AuthContext,
    customerId: string,
    itemNumber: string | null,
    qrCode: string | null,
    exceptId?: string,
  ) {
    if (itemNumber) {
      const [row] = await tx
        .select({ id: item.id })
        .from(item)
        .where(
          and(
            eq(item.customerId, customerId),
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

  async function nextItemNumber(tx: DbOrTx, customerId: string): Promise<string> {
    const [row] = await tx
      .select({ value: sql<string | null>`max(${item.itemNumber}::bigint)::text` })
      .from(item)
      .where(eq(item.customerId, customerId));
    const next = BigInt(row?.value ?? '0') + 1n;
    if (next > 99_999_999n) throw new AppError(409, 'numbers_exhausted', 'Došla čísla artiklů.');
    return next.toString();
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
    await assertUnique(
      tx,
      auth,
      current.customerId,
      itemNumber ?? null,
      qrCode ?? null,
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
        qrCode,
        fieldValues,
        status: input.status,
        nextInspectionDate: input.nextInspectionDate,
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
      if (query.locationId)
        filters.push(sql`${location.pathIds} @> array[${query.locationId}]::uuid[]`);
      if (query.q) {
        const pattern = `%${likePattern(query.q)}%`;
        const number = canonicalItemNumber(query.q);
        filters.push(
          sql`(${number ? sql`${item.itemNumber} like ${`${number}%`} or ` : sql``}${item.qrCode} ilike ${pattern} or ${item.fieldValues}::text ilike ${pattern})`,
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
          : await nextItemNumber(tx, targetSite.customerId);
        await assertUnique(tx, auth, targetSite.customerId, itemNumber, input.qrCode ?? null);

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
            qrCode: input.qrCode ?? null,
            fieldValues,
            nextInspectionDate: input.nextInspectionDate ?? null,
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
        if (current.version !== input.version) throw versionConflict();
        const { version, ...changes } = input;
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
