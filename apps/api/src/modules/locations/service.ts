import {
  locationPath,
  newId,
  type Location,
  type createLocationSchema,
  type createLocationSeriesSchema,
  type updateLocationSchema,
} from '@revize/shared';
import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { item, location, site } from '../../db/schema.js';
import { AppError, notFound, versionConflict } from '../../errors.js';
import { recordAudit } from '../audit/service.js';

type LocationRow = typeof location.$inferSelect;

// Qualified names on purpose, see customers/service.ts.
const directItemCount = sql<number>`(select count(*)::int from item i where i.location_id = "location"."id" and i.retired_at is null)`;

/** Names of all locations of a site (archived too), to turn path ids into readable paths. */
export async function locationNames(db: DbOrTx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: location.id, name: location.name })
    .from(location)
    .where(inArray(location.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function pathNamesOf(pathIds: string[], names: Map<string, string>): string[] {
  return pathIds.map((id) => names.get(id) ?? '?');
}

/** Inserts one location (with its materialized path) and audits it. */
export async function insertLocation(
  tx: DbOrTx,
  auth: AuthContext,
  siteId: string,
  parent: LocationRow | null,
  values: { id: string; name: string; sortOrder: number; inspectionIntervalMonths?: number | null },
) {
  const path = locationPath(parent, values.id, values.sortOrder);
  const [row] = await tx
    .insert(location)
    .values({
      ...values,
      siteId,
      parentId: parent?.id ?? null,
      organizationId: auth.organizationId,
      ...path,
    })
    .returning();
  await recordAudit(tx, {
    organizationId: auth.organizationId,
    actorUserId: auth.userId,
    action: 'location.create',
    entityType: 'location',
    entityId: values.id,
    after: row,
  });
  return row!;
}

export function createLocationsService(db: Db) {
  async function assertSite(tx: DbOrTx, auth: AuthContext, siteId: string) {
    const [row] = await tx
      .select({ id: site.id, archivedAt: site.archivedAt })
      .from(site)
      .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, siteId)));
    if (!row) throw notFound('Provozovna neexistuje.');
    return row;
  }

  async function getRow(tx: DbOrTx, auth: AuthContext, id: string): Promise<LocationRow> {
    const [row] = await tx
      .select()
      .from(location)
      .where(and(eq(location.organizationId, auth.organizationId), eq(location.id, id)));
    if (!row) throw notFound('Umístění neexistuje.');
    return row;
  }

  async function parentOf(tx: DbOrTx, auth: AuthContext, siteId: string, parentId: string | null) {
    if (parentId === null) return null;
    const parent = await getRow(tx, auth, parentId);
    if (parent.siteId !== siteId) {
      throw new AppError(400, 'validation', 'Nadřazené umístění patří jiné provozovně.', [
        { path: ['parentId'], message: 'Jiná provozovna' },
      ]);
    }
    if (parent.archivedAt) {
      throw new AppError(400, 'validation', 'Nadřazené umístění je archivované.', [
        { path: ['parentId'], message: 'Archivované umístění' },
      ]);
    }
    return parent;
  }

  async function nextSortOrder(tx: DbOrTx, siteId: string, parentId: string | null) {
    const [row] = await tx
      .select({ value: max(location.sortOrder) })
      .from(location)
      .where(
        and(
          eq(location.siteId, siteId),
          parentId ? eq(location.parentId, parentId) : isNull(location.parentId),
        ),
      );
    return (row?.value ?? 0) + 1;
  }

  async function toDtos(
    tx: DbOrTx,
    rows: (LocationRow & { itemCount: number })[],
  ): Promise<Location[]> {
    const names = await locationNames(
      tx,
      rows.flatMap((r) => r.pathIds),
    );
    return rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      parentId: r.parentId,
      name: r.name,
      sortOrder: r.sortOrder,
      pathNames: pathNamesOf(r.pathIds, names),
      depth: r.pathIds.length - 1,
      inspectionIntervalMonths: r.inspectionIntervalMonths,
      archived: r.archivedAt !== null,
      itemCount: r.itemCount,
      version: r.version,
    }));
  }

  return {
    /** All locations of a site in tree order (parents before children, siblings by sort order). */
    async list(auth: AuthContext, siteId: string, includeArchived = false): Promise<Location[]> {
      await assertSite(db, auth, siteId);
      const rows = await db
        .select({ row: location, itemCount: directItemCount })
        .from(location)
        .where(
          and(
            eq(location.siteId, siteId),
            includeArchived ? undefined : isNull(location.archivedAt),
          ),
        )
        .orderBy(asc(location.sortPath), asc(location.name));
      return toDtos(
        db,
        rows.map((r) => ({ ...r.row, itemCount: r.itemCount })),
      );
    },

    async create(
      auth: AuthContext,
      siteId: string,
      input: z.output<typeof createLocationSchema>,
    ): Promise<Location> {
      const id = input.id ?? newId();
      const row = await db.transaction(async (tx) => {
        await assertSite(tx, auth, siteId);
        const [existing] = await tx.select().from(location).where(eq(location.id, id));
        if (existing) return existing; // repeated request with the same client id
        const parent = await parentOf(tx, auth, siteId, input.parentId);
        const sortOrder = input.sortOrder ?? (await nextSortOrder(tx, siteId, input.parentId));
        return insertLocation(tx, auth, siteId, parent, {
          id,
          name: input.name,
          sortOrder,
          inspectionIntervalMonths: input.inspectionIntervalMonths ?? null,
        });
      });
      return (await toDtos(db, [{ ...row, itemCount: 0 }]))[0]!;
    },

    /** "Pozice 1" … "Pozice 20": numbers double as sort order so that 2 sorts before 10. */
    async createSeries(
      auth: AuthContext,
      siteId: string,
      input: z.output<typeof createLocationSeriesSchema>,
    ): Promise<Location[]> {
      const rows = await db.transaction(async (tx) => {
        await assertSite(tx, auth, siteId);
        const parent = await parentOf(tx, auth, siteId, input.parentId);
        const created: LocationRow[] = [];
        for (let n = input.from; n <= input.to; n++) {
          const name = input.prefix ? `${input.prefix} ${n}` : String(n);
          created.push(
            await insertLocation(tx, auth, siteId, parent, { id: newId(), name, sortOrder: n }),
          );
        }
        return created;
      });
      return toDtos(
        db,
        rows.map((r) => ({ ...r, itemCount: 0 })),
      );
    },

    async update(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateLocationSchema>,
    ): Promise<Location> {
      const updated = await db.transaction(async (tx) => {
        const current = await getRow(tx, auth, id);
        if (current.version !== input.version) throw versionConflict();

        if (input.archived === true && !current.archivedAt) {
          const [active] = await tx
            .select({ value: sql<number>`count(*)::int` })
            .from(item)
            .innerJoin(location, eq(location.id, item.locationId))
            .where(and(sql`${location.pathIds} @> array[${id}]::uuid[]`, isNull(item.retiredAt)));
          if ((active?.value ?? 0) > 0) {
            throw new AppError(
              409,
              'location_has_items',
              `V umístění (nebo pod ním) je ${active!.value} artiklů. Nejdřív je přesuňte.`,
            );
          }
        }

        const moving = input.parentId !== undefined && input.parentId !== current.parentId;
        const parentId = moving ? input.parentId! : current.parentId;
        const parent = moving ? await parentOf(tx, auth, current.siteId, parentId) : null;
        if (parent?.pathIds.includes(id)) {
          throw new AppError(400, 'location_cycle', 'Umístění nelze přesunout pod sebe sama.', [
            { path: ['parentId'], message: 'Cyklus ve stromu' },
          ]);
        }
        const sortOrder =
          input.sortOrder ??
          (moving ? await nextSortOrder(tx, current.siteId, parentId) : current.sortOrder);
        const pathChanged = moving || sortOrder !== current.sortOrder;
        const parentPath = moving
          ? parent
          : current.parentId
            ? await getRow(tx, auth, current.parentId)
            : null;
        const path = pathChanged ? locationPath(parentPath, id, sortOrder) : null;

        const [row] = await tx
          .update(location)
          .set({
            name: input.name,
            sortOrder,
            parentId,
            inspectionIntervalMonths: input.inspectionIntervalMonths,
            ...(path ?? {}),
            archivedAt:
              input.archived === undefined
                ? undefined
                : input.archived
                  ? (current.archivedAt ?? new Date())
                  : null,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(location.id, id), eq(location.version, input.version)))
          .returning();
        if (!row) throw versionConflict();

        // Re-root the whole subtree onto the new path in one statement. The ids come from the
        // database (uuid columns), so inlining them as an array literal is safe; drizzle would
        // otherwise expand a JS array into a parameter list.
        if (path) {
          const oldDepth = current.pathIds.length;
          await tx.execute(sql`
            update ${location}
            set path_ids = ${sql.raw(`'{${path.pathIds.join(',')}}'::uuid[]`)} || path_ids[${oldDepth + 1}:],
                sort_path = ${path.sortPath} || substr(sort_path, ${current.sortPath.length + 1}),
                updated_at = now()
            where path_ids @> array[${id}]::uuid[] and id <> ${id}
          `);
        }
        // Archiving a location archives its subtree as well.
        if (input.archived === true) {
          await tx
            .update(location)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(
              and(sql`${location.pathIds} @> array[${id}]::uuid[]`, isNull(location.archivedAt)),
            );
        }
        await recordAudit(tx, {
          organizationId: auth.organizationId,
          actorUserId: auth.userId,
          action:
            input.archived === true
              ? 'location.archive'
              : moving
                ? 'location.move'
                : 'location.update',
          entityType: 'location',
          entityId: id,
          before: current,
          after: row,
        });
        return row;
      });
      const [withCount] = await db
        .select({ itemCount: directItemCount })
        .from(location)
        .where(eq(location.id, updated.id));
      return (await toDtos(db, [{ ...updated, itemCount: withCount?.itemCount ?? 0 }]))[0]!;
    },
  };
}

export type LocationsService = ReturnType<typeof createLocationsService>;
