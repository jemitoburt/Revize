import { idSchema } from '@revize/shared';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { ExportFile, ExportsService } from './service.js';

const params = z.object({ id: idSchema });

/** RFC 6266: ASCII fallback plus the UTF-8 name. */
const disposition = (fileName: string) =>
  `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export const exportsRoutes: FastifyPluginAsyncZod<{ exports: ExportsService }> = async (
  app,
  { exports },
) => {
  const read = requirePermission('inspection.read');
  const tags = ['Exporty'];
  const send = (reply: FastifyReply, file: ExportFile<unknown>) =>
    reply
      .header('content-type', file.contentType)
      .header('content-disposition', disposition(file.fileName))
      .send(file.data);

  app.get(
    '/inspections/:id/export.xlsx',
    {
      preHandler: read,
      schema: { tags, summary: 'Výsledky kontroly v XLSX (list pro každý typ)', params },
    },
    async (req, reply) => {
      const file = await exports.xlsx(authOf(req), req.params.id);
      return send(reply, { ...file, data: Buffer.from(file.data) });
    },
  );

  app.get(
    '/inspections/:id/export.csv',
    {
      preHandler: read,
      schema: { tags, summary: 'Výsledky kontroly v CSV (UTF-8, středník)', params },
    },
    async (req, reply) => send(reply, await exports.csv(authOf(req), req.params.id)),
  );

  app.get(
    '/inspections/:id/photos.zip',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Fotky kontroly v ZIP (názvy podle čísla artiklu, popis v EXIF/IPTC, fotky.csv)',
        params,
      },
    },
    async (req, reply) => send(reply, await exports.photosZip(authOf(req), req.params.id)),
  );
};
