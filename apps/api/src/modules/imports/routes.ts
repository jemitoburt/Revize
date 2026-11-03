import {
  IMPORT_LIMITS,
  apiErrorSchema,
  columnValuesSchema,
  commitImportSchema,
  idSchema,
  importJobSchema,
  importReportSchema,
  importResultSchema,
  importSuggestionSchema,
  validateImportSchema,
} from '@revize/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { Db } from '../../db/client.js';
import { equipmentType } from '../../db/schema.js';
import { AppError, notFound } from '../../errors.js';
import type { ImportsService } from './service.js';
import { importTemplate } from './template.js';

const params = z.object({ id: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const importsRoutes: FastifyPluginAsyncZod<{ imports: ImportsService; db: Db }> = async (
  app,
  { imports, db },
) => {
  const guard = requirePermission('item.import');
  const tags = ['Import'];

  app.post(
    '/imports',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Nahrát XLSX/CSV (multipart, pole „file“, volitelně „sheet“)',
        consumes: ['multipart/form-data'],
        response: { 201: importJobSchema, ...errors },
      },
    },
    async (request, reply) => {
      const file = await request.file({ limits: { fileSize: IMPORT_LIMITS.maxFileBytes } });
      if (!file) throw new AppError(400, 'invalid_file', 'Vyberte soubor.');
      const buffer = await file.toBuffer().catch(() => {
        throw new AppError(
          400,
          'invalid_file',
          `Soubor je větší než ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
        );
      });
      const sheetField = file.fields.sheet;
      const sheet =
        sheetField && !Array.isArray(sheetField) && sheetField.type === 'field'
          ? String(sheetField.value)
          : undefined;
      return reply
        .code(201)
        .send(await imports.upload(authOf(request), file.filename, buffer, sheet || undefined));
    },
  );

  app.get(
    '/imports/:id/suggestion',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Návrh mapování sloupců (podle názvů a posledního importu typu)',
        params,
        querystring: z.object({ equipmentTypeId: idSchema }),
        response: { 200: importSuggestionSchema, ...errors },
      },
    },
    (req) => imports.suggestion(authOf(req), req.params.id, req.query.equipmentTypeId),
  );

  app.get(
    '/imports/:id/columns/:column/values',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Hodnoty ve sloupci souboru s počty (pro náhrady hodnot)',
        params: z.object({ id: idSchema, column: z.coerce.number().int().min(0) }),
        response: { 200: columnValuesSchema, ...errors },
      },
    },
    (req) => imports.columnValues(authOf(req), req.params.id, req.params.column),
  );

  app.post(
    '/imports/:id/validate',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Zkontrolovat import (nic se neukládá) – výsledek po řádcích',
        params,
        body: validateImportSchema,
        response: { 200: importReportSchema, ...errors },
      },
    },
    (req) => imports.validate(authOf(req), req.params.id, req.body.mapping),
  );

  app.post(
    '/imports/:id/commit',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Provést import (v jedné transakci)',
        params,
        body: commitImportSchema,
        response: { 200: importResultSchema, ...errors },
      },
    },
    (req) => imports.commit(authOf(req), req.params.id, req.body.mapping, req.body.skipErrors),
  );

  app.get(
    '/equipment-types/:id/import-template',
    {
      preHandler: guard,
      schema: { tags, summary: 'Prázdná XLSX šablona pro import artiklů daného typu', params },
    },
    async (req, reply) => {
      const auth = authOf(req);
      const [type] = await db
        .select()
        .from(equipmentType)
        .where(
          and(
            eq(equipmentType.organizationId, auth.organizationId),
            eq(equipmentType.id, req.params.id),
          ),
        );
      if (!type) throw notFound('Typ vybavení neexistuje.');
      const file = await importTemplate(type.name, type.fieldDefinitions);
      const name = `import-${type.name}.xlsx`;
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header(
          'content-disposition',
          `attachment; filename="import.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        )
        .send(file);
    },
  );
};
