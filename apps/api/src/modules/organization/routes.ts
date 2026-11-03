import {
  LOGO_LIMITS,
  apiErrorSchema,
  organizationSchema,
  updateOrganizationSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requireAuth, requirePermission } from '../../auth/plugin.js';
import { AppError } from '../../errors.js';
import type { OrganizationService } from './service.js';

const errors = { 400: apiErrorSchema, 404: apiErrorSchema };

export const organizationRoutes: FastifyPluginAsyncZod<{
  organization: OrganizationService;
}> = async (app, { organization }) => {
  const manage = requirePermission('settings.manage');
  const tags = ['Nastavení'];

  app.get(
    '/organization',
    {
      preHandler: requireAuth,
      schema: {
        tags,
        summary: 'Údaje firmy a texty protokolu',
        response: { 200: organizationSchema },
      },
    },
    (req) => organization.get(authOf(req)),
  );
  app.put(
    '/organization',
    {
      preHandler: manage,
      schema: {
        tags,
        summary: 'Uložit údaje firmy a texty protokolu',
        body: updateOrganizationSchema,
        response: { 200: organizationSchema, ...errors },
      },
    },
    (req) => organization.update(authOf(req), req.body),
  );
  app.put(
    '/organization/logo',
    {
      preHandler: manage,
      schema: {
        tags,
        summary: 'Nahrát logo (multipart, pole „file“, PNG/JPEG do 2 MB)',
        consumes: ['multipart/form-data'],
        response: { 200: organizationSchema, ...errors },
      },
    },
    async (request) => {
      const file = await request.file({ limits: { fileSize: LOGO_LIMITS.maxBytes } });
      if (!file) throw new AppError(400, 'invalid_logo', 'Vyberte soubor s logem.');
      const data = await file.toBuffer().catch(() => {
        throw new AppError(400, 'invalid_logo', 'Logo je větší než 2 MB.');
      });
      return organization.setLogo(authOf(request), { mimetype: file.mimetype, data });
    },
  );
  app.delete(
    '/organization/logo',
    {
      preHandler: manage,
      schema: { tags, summary: 'Odebrat logo', response: { 204: z.null() } },
    },
    async (req, reply) => {
      await organization.deleteLogo(authOf(req));
      return reply.code(204).send(null);
    },
  );
  app.get(
    '/organization/logo',
    { preHandler: requireAuth, schema: { tags, summary: 'Logo firmy' } },
    async (req, reply) => {
      const { data, mimeType } = await organization.logo(authOf(req));
      return reply
        .header('content-type', mimeType)
        .header('cache-control', 'private, no-cache')
        .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
  );
};
