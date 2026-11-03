import { and, count, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client.js';
import { appUser } from '../../db/schema.js';

export type UserRow = typeof appUser.$inferSelect;

export const usersRepository = {
  async listByOrganization(db: DbOrTx, organizationId: string): Promise<UserRow[]> {
    return db
      .select()
      .from(appUser)
      .where(and(eq(appUser.organizationId, organizationId), isNull(appUser.deletedAt)))
      .orderBy(appUser.displayName);
  },

  async findById(db: DbOrTx, organizationId: string, id: string): Promise<UserRow | null> {
    const [row] = await db
      .select()
      .from(appUser)
      .where(
        and(
          eq(appUser.organizationId, organizationId),
          eq(appUser.id, id),
          isNull(appUser.deletedAt),
        ),
      );
    return row ?? null;
  },

  /** E-mails are unique across organizations (login needs only the e-mail). */
  async findByEmail(db: DbOrTx, email: string): Promise<UserRow | null> {
    const [row] = await db.select().from(appUser).where(eq(appUser.email, email));
    return row ?? null;
  },

  async insert(db: DbOrTx, values: typeof appUser.$inferInsert): Promise<UserRow> {
    const [row] = await db.insert(appUser).values(values).returning();
    return row!;
  },

  /** Updates when `version` still matches; returns null on a concurrent change. */
  async update(
    db: DbOrTx,
    organizationId: string,
    id: string,
    version: number,
    values: Partial<typeof appUser.$inferInsert>,
  ): Promise<UserRow | null> {
    const [row] = await db
      .update(appUser)
      .set({ ...values, version: version + 1, updatedAt: new Date() })
      .where(
        and(
          eq(appUser.organizationId, organizationId),
          eq(appUser.id, id),
          eq(appUser.version, version),
        ),
      )
      .returning();
    return row ?? null;
  },

  async countActiveAdmins(db: DbOrTx, organizationId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(appUser)
      .where(
        and(
          eq(appUser.organizationId, organizationId),
          eq(appUser.role, 'admin'),
          eq(appUser.active, true),
          isNull(appUser.deletedAt),
        ),
      );
    return row?.value ?? 0;
  },

  async countAll(db: DbOrTx): Promise<number> {
    const [row] = await db.select({ value: count() }).from(appUser);
    return row?.value ?? 0;
  },
};
