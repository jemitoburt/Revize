import { idSchema } from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { ProtocolsService } from './service.js';

const params = z.object({ id: idSchema });

export const protocolsRoutes: FastifyPluginAsyncZod<{ protocols: ProtocolsService }> = async (
  app,
  { protocols },
) => {
  const read = requirePermission('inspection.read');
  const tags = ['Protokoly'];

  app.get(
    '/inspections/:id/protocol.html',
    {
      preHandler: read,
      schema: { tags, summary: 'Protokol kontroly jako HTML (náhled, tisk)', params },
    },
    async (req, reply) =>
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .send(await protocols.html(authOf(req), req.params.id)),
  );
  app.get(
    '/inspections/:id/protocol.pdf',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Protokol kontroly v PDF (před uzavřením označený jako předběžný)',
        params,
      },
    },
    async (req, reply) => {
      const { data, fileName } = await protocols.pdf(authOf(req), req.params.id);
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
  );
};
