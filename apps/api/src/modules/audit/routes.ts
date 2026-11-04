import { auditEntrySchema, idSchema } from '@revize/shared';
import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { Db } from '../../db/client.js';
import { appUser, auditLog } from '../../db/schema.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ve formátu RRRR-MM-DD');

export const auditRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/audit',
    {
      preHandler: requirePermission('audit.read'),
      schema: {
        tags: ['Audit'],
        summary: 'Auditní záznamy (nejnovější první)',
        querystring: z.object({
          entityType: z.string().optional(),
          entityId: idSchema.optional(),
          /** Who made the change. */
          actorId: idSchema.optional(),
          /** Day range (Czech time is close enough: whole days in UTC). */
          from: isoDate.optional(),
          to: isoDate.optional(),
          /** Paging: return entries older than this id (ids are time-ordered UUIDv7). */
          before: idSchema.optional(),
          limit: z.coerce.number().int().min(1).max(500).default(100),
        }),
        response: { 200: z.array(auditEntrySchema) },
      },
    },
    async (request) => {
      const { entityType, entityId, actorId, from, to, before, limit } = request.query;
      const filters: SQL[] = [eq(auditLog.organizationId, authOf(request).organizationId)];
      if (entityType) filters.push(eq(auditLog.entityType, entityType));
      if (entityId) filters.push(eq(auditLog.entityId, entityId));
      if (actorId) filters.push(eq(auditLog.actorUserId, actorId));
      if (from) filters.push(gte(auditLog.createdAt, new Date(`${from}T00:00:00Z`)));
      if (to)
        filters.push(
          lt(auditLog.createdAt, new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)),
        );
      if (before) filters.push(lt(auditLog.id, before));
      const rows = await db
        .select({ entry: auditLog, actorName: appUser.displayName })
        .from(auditLog)
        .leftJoin(appUser, eq(appUser.id, auditLog.actorUserId))
        .where(and(...filters))
        .orderBy(desc(auditLog.id))
        .limit(limit);
      return rows.map(({ entry, actorName }) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        actor: entry.actorUserId ? { id: entry.actorUserId, displayName: actorName ?? '' } : null,
        before: entry.before,
        after: entry.after,
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      }));
    },
  );
};
