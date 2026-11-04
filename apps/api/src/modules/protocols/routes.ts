import { idSchema } from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { ProtocolsService } from './service.js';

const params = z.object({ id: idSchema });
/** Optional: the protocol of one equipment type only (its text and its items). */
const querystring = z.object({
  equipmentTypeId: idSchema.optional(),
  /** Columns of Příloha 1, comma separated (see protocol-columns); empty = preset columns. */
  columns: z.string().max(2000).optional(),
  /** `always`: the equipment table as Příloha 1 even when it fits on the first page. */
  appendix: z.enum(['auto', 'always']).default('auto'),
  /** `appendix`: only Příloha 1 (printed on its own). */
  part: z.enum(['all', 'appendix']).default('all'),
  /** Defects with cards and photos: only red, red and yellow, or all (default). */
  defects: z.enum(['red', 'red-amber', 'all']).default('all'),
  /** `shortest`: the fewest pages (smallest photos, more columns) even within 8 pages. */
  size: z.enum(['auto', 'shortest']).default('auto'),
});
const SEVERITIES_OF = {
  red: ['red'],
  'red-amber': ['red', 'amber'],
  all: ['red', 'amber', 'green'],
} as const;
const optionsOf = (q: {
  equipmentTypeId?: string;
  columns?: string;
  appendix: 'auto' | 'always';
  part: 'all' | 'appendix';
  defects: keyof typeof SEVERITIES_OF;
  size: 'auto' | 'shortest';
}) => ({
  shortest: q.size === 'shortest',
  severities: [...SEVERITIES_OF[q.defects]],
  equipmentTypeId: q.equipmentTypeId,
  columns: q.columns ? q.columns.split(',').filter(Boolean) : [],
  forceAppendix: q.appendix === 'always',
  part: q.part,
});
const pdfQuery = querystring.extend({
  /** `two-up`: two A4 pages on one landscape A4 sheet. */
  layout: z.enum(['a4', 'two-up']).default('a4'),
});

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
      schema: { tags, summary: 'Protokol kontroly jako HTML (náhled, tisk)', params, querystring },
    },
    async (req, reply) =>
      reply
        .header('content-type', 'text/html; charset=utf-8')
        .send(await protocols.html(authOf(req), req.params.id, optionsOf(req.query))),
  );
  app.get(
    '/inspections/:id/protocol.pdf',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Protokol kontroly v PDF (před uzavřením označený jako předběžný)',
        params,
        querystring: pdfQuery,
      },
    },
    async (req, reply) => {
      const { data, fileName } = await protocols.pdf(authOf(req), req.params.id, {
        ...optionsOf(req.query),
        twoUp: req.query.layout === 'two-up',
      });
      return reply
        .header('content-type', 'application/pdf')
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
  );
  app.get(
    '/inspections/:id/protocol.docx',
    {
      preHandler: read,
      schema: { tags, summary: 'Protokol kontroly ve Wordu (DOCX)', params, querystring },
    },
    async (req, reply) => {
      const { data, fileName } = await protocols.docx(
        authOf(req),
        req.params.id,
        optionsOf(req.query),
      );
      return reply
        .header(
          'content-type',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        )
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="${fileName}"`)
        .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    },
  );
  app.get(
    '/inspections/:id/protocol-columns',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Sloupce, které jde vybrat do přílohy protokolu (seznam vybavení)',
        params,
        response: { 200: z.array(z.object({ key: z.string(), label: z.string() })) },
      },
    },
    (req) => protocols.columns(authOf(req), req.params.id),
  );
};
