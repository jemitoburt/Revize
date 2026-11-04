import {
  newId,
  type Customer,
  type Site,
  type createCustomerSchema,
  type createSiteSchema,
  type updateCustomerSchema,
  type updateSiteSchema,
} from '@revize/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { customer, site } from '../../db/schema.js';
import { conflict, notFound, versionConflict } from '../../errors.js';
import { recordAudit } from '../audit/service.js';

type CustomerRow = typeof customer.$inferSelect;
type SiteRow = typeof site.$inferSelect;

// Correlated subqueries are written with qualified names: drizzle renders column references in
// `sql` without the table, which inside a subquery would resolve to the inner table.
const siteCount = sql<number>`(select count(*)::int from site s where s.customer_id = "customer"."id" and s.archived_at is null)`;
const customerItemCount = sql<number>`(select count(*)::int from item i where i.customer_id = "customer"."id" and i.retired_at is null)`;
const siteItemCount = sql<number>`(select count(*)::int from item i where i.site_id = "site"."id" and i.retired_at is null)`;

function toCustomer(row: CustomerRow, counts: { siteCount: number; itemCount: number }): Customer {
  return {
    id: row.id,
    name: row.name,
    companyId: row.companyId,
    address: row.address,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    note: row.note,
    archived: row.archivedAt !== null,
    version: row.version,
    ...counts,
  };
}

function toSite(row: SiteRow, itemCount: number): Site {
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    address: row.address,
    note: row.note,
    inspectionIntervalMonths: row.inspectionIntervalMonths,
    archived: row.archivedAt !== null,
    itemCount,
    version: row.version,
  };
}

/** `archived: true/false` from the API maps to `archived_at`. */
function archivedAt(archived: boolean | undefined, current: Date | null): Date | null | undefined {
  if (archived === undefined) return undefined;
  return archived ? (current ?? new Date()) : null;
}

export function createCustomersService(db: Db) {
  async function getCustomerRow(tx: DbOrTx, auth: AuthContext, id: string) {
    const [row] = await tx
      .select()
      .from(customer)
      .where(and(eq(customer.organizationId, auth.organizationId), eq(customer.id, id)));
    if (!row) throw notFound('Zákazník neexistuje.');
    return row;
  }

  async function getSiteRow(tx: DbOrTx, auth: AuthContext, id: string) {
    const [row] = await tx
      .select()
      .from(site)
      .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, id)));
    if (!row) throw notFound('Provozovna neexistuje.');
    return row;
  }

  const audit = (
    tx: DbOrTx,
    auth: AuthContext,
    action: string,
    entityType: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) =>
    recordAudit(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action,
      entityType,
      entityId,
      before,
      after,
    });

  return {
    getSiteRow: (auth: AuthContext, id: string) => getSiteRow(db, auth, id),

    async list(auth: AuthContext, includeArchived = false): Promise<Customer[]> {
      const rows = await db
        .select({ row: customer, siteCount, itemCount: customerItemCount })
        .from(customer)
        .where(
          and(
            eq(customer.organizationId, auth.organizationId),
            includeArchived ? undefined : isNull(customer.archivedAt),
          ),
        )
        .orderBy(asc(customer.name));
      return rows.map((r) => toCustomer(r.row, r));
    },

    async get(auth: AuthContext, id: string): Promise<Customer> {
      const [r] = await db
        .select({ row: customer, siteCount, itemCount: customerItemCount })
        .from(customer)
        .where(and(eq(customer.organizationId, auth.organizationId), eq(customer.id, id)));
      if (!r) throw notFound('Zákazník neexistuje.');
      return toCustomer(r.row, r);
    },

    async create(
      auth: AuthContext,
      input: z.output<typeof createCustomerSchema>,
    ): Promise<Customer> {
      const id = input.id ?? newId();
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(customer).where(eq(customer.id, id));
        if (existing) {
          // Repeated request with the same client id (ADR-0004).
          if (existing.organizationId !== auth.organizationId)
            throw conflict('id_taken', 'ID je již použito.');
          return toCustomer(existing, { siteCount: 0, itemCount: 0 });
        }
        const { id: _ignored, ...values } = input;
        const [row] = await tx
          .insert(customer)
          .values({ ...values, id, organizationId: auth.organizationId })
          .returning();
        await audit(tx, auth, 'customer.create', 'customer', id, null, row);
        return toCustomer(row!, { siteCount: 0, itemCount: 0 });
      });
    },

    async update(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateCustomerSchema>,
    ): Promise<Customer> {
      await db.transaction(async (tx) => {
        const current = await getCustomerRow(tx, auth, id);
        if (current.version !== input.version) throw versionConflict();
        const { version, archived, ...changes } = input;
        const [row] = await tx
          .update(customer)
          .set({
            ...changes,
            archivedAt: archivedAt(archived, current.archivedAt),
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(customer.id, id), eq(customer.version, version)))
          .returning();
        if (!row) throw versionConflict();
        await audit(
          tx,
          auth,
          archived === true ? 'customer.archive' : 'customer.update',
          'customer',
          id,
          current,
          row,
        );
      });
      return this.get(auth, id);
    },

    async listSites(
      auth: AuthContext,
      customerId: string,
      includeArchived = false,
    ): Promise<Site[]> {
      await getCustomerRow(db, auth, customerId);
      const rows = await db
        .select({ row: site, itemCount: siteItemCount })
        .from(site)
        .where(
          and(
            eq(site.customerId, customerId),
            includeArchived ? undefined : isNull(site.archivedAt),
          ),
        )
        .orderBy(asc(site.name));
      return rows.map((r) => toSite(r.row, r.itemCount));
    },

    async getSite(auth: AuthContext, id: string): Promise<Site> {
      const [r] = await db
        .select({ row: site, itemCount: siteItemCount })
        .from(site)
        .where(and(eq(site.organizationId, auth.organizationId), eq(site.id, id)));
      if (!r) throw notFound('Provozovna neexistuje.');
      return toSite(r.row, r.itemCount);
    },

    async createSite(
      auth: AuthContext,
      customerId: string,
      input: z.output<typeof createSiteSchema>,
    ): Promise<Site> {
      const id = input.id ?? newId();
      return db.transaction(async (tx) => {
        await getCustomerRow(tx, auth, customerId);
        const [existing] = await tx.select().from(site).where(eq(site.id, id));
        if (existing) {
          if (existing.organizationId !== auth.organizationId)
            throw conflict('id_taken', 'ID je již použito.');
          return toSite(existing, 0);
        }
        const { id: _ignored, ...values } = input;
        const [row] = await tx
          .insert(site)
          .values({ ...values, id, customerId, organizationId: auth.organizationId })
          .returning();
        await audit(tx, auth, 'site.create', 'site', id, null, row);
        return toSite(row!, 0);
      });
    },

    async updateSite(
      auth: AuthContext,
      id: string,
      input: z.output<typeof updateSiteSchema>,
    ): Promise<Site> {
      await db.transaction(async (tx) => {
        const current = await getSiteRow(tx, auth, id);
        if (current.version !== input.version) throw versionConflict();
        const { version, archived, ...changes } = input;
        const [row] = await tx
          .update(site)
          .set({
            ...changes,
            archivedAt: archivedAt(archived, current.archivedAt),
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(site.id, id), eq(site.version, version)))
          .returning();
        if (!row) throw versionConflict();
        await audit(
          tx,
          auth,
          archived === true ? 'site.archive' : 'site.update',
          'site',
          id,
          current,
          row,
        );
      });
      return this.getSite(auth, id);
    },
  };
}

export type CustomersService = ReturnType<typeof createCustomersService>;
