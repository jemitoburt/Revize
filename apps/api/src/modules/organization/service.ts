import {
  LOGO_LIMITS,
  organizationSettingsSchema,
  type Organization,
  type OrganizationSettings,
  type updateOrganizationSchema,
} from '@revize/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { AuthContext } from '../../auth/context.js';
import type { Db, DbOrTx } from '../../db/client.js';
import { organization } from '../../db/schema.js';
import { AppError, notFound } from '../../errors.js';
import type { FileStorage } from '../../infra/file-storage.js';
import { recordAudit } from '../audit/service.js';

type OrganizationRow = typeof organization.$inferSelect;

/** Stored settings with defaults for fields added later. */
export function settingsOf(row: OrganizationRow): OrganizationSettings {
  return organizationSettingsSchema.parse(row.settings ?? {});
}

export async function organizationOf(tx: DbOrTx, auth: AuthContext): Promise<OrganizationRow> {
  const [row] = await tx
    .select()
    .from(organization)
    .where(eq(organization.id, auth.organizationId));
  if (!row) throw notFound('Organizace neexistuje.');
  return row;
}

export function createOrganizationService(db: Db, files: FileStorage) {
  const toDto = (row: OrganizationRow): Organization => ({
    id: row.id,
    name: row.name,
    settings: settingsOf(row),
    hasLogo: row.logoKey !== null,
    updatedAt: row.updatedAt.toISOString(),
  });
  const audit = (tx: DbOrTx, auth: AuthContext, action: string, before: unknown, after: unknown) =>
    recordAudit(tx, {
      organizationId: auth.organizationId,
      actorUserId: auth.userId,
      action,
      entityType: 'organization',
      entityId: auth.organizationId,
      before,
      after,
    });

  return {
    get: async (auth: AuthContext) => toDto(await organizationOf(db, auth)),

    async update(
      auth: AuthContext,
      input: z.output<typeof updateOrganizationSchema>,
    ): Promise<Organization> {
      return db.transaction(async (tx) => {
        const before = await organizationOf(tx, auth);
        const [row] = await tx
          .update(organization)
          .set({ name: input.name, settings: input.settings, updatedAt: new Date() })
          .where(eq(organization.id, auth.organizationId))
          .returning();
        await audit(tx, auth, 'organization.update', before, row);
        return toDto(row!);
      });
    },

    async setLogo(
      auth: AuthContext,
      file: { mimetype: string; data: Uint8Array },
    ): Promise<Organization> {
      if (!(LOGO_LIMITS.mimeTypes as readonly string[]).includes(file.mimetype)) {
        throw new AppError(400, 'invalid_logo', 'Logo musí být obrázek PNG nebo JPEG.');
      }
      if (file.data.byteLength > LOGO_LIMITS.maxBytes) {
        throw new AppError(400, 'invalid_logo', 'Logo je větší než 2 MB.');
      }
      const key = `organization/${auth.organizationId}/logo-${Date.now()}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`;
      await files.put(key, file.data);
      const { previous, dto } = await db.transaction(async (tx) => {
        const before = await organizationOf(tx, auth);
        const [row] = await tx
          .update(organization)
          .set({ logoKey: key, logoMimeType: file.mimetype, updatedAt: new Date() })
          .where(eq(organization.id, auth.organizationId))
          .returning();
        await audit(tx, auth, 'organization.logo', { logoKey: before.logoKey }, { logoKey: key });
        return { previous: before.logoKey, dto: toDto(row!) };
      });
      if (previous) await files.delete(previous);
      return dto;
    },

    async deleteLogo(auth: AuthContext): Promise<void> {
      const previous = await db.transaction(async (tx) => {
        const before = await organizationOf(tx, auth);
        await tx
          .update(organization)
          .set({ logoKey: null, logoMimeType: null, updatedAt: new Date() })
          .where(eq(organization.id, auth.organizationId));
        await audit(tx, auth, 'organization.logo', { logoKey: before.logoKey }, { logoKey: null });
        return before.logoKey;
      });
      if (previous) await files.delete(previous);
    },

    async logo(auth: AuthContext): Promise<{ data: Uint8Array; mimeType: string }> {
      const row = await organizationOf(db, auth);
      if (!row.logoKey || !row.logoMimeType) throw notFound('Logo není nahrané.');
      return { data: await files.read(row.logoKey), mimeType: row.logoMimeType };
    },
  };
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;
