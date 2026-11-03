import {
  apiErrorSchema,
  createEquipmentTypeSchema,
  equipmentTypePresetSchema,
  conversionPreviewRequestSchema,
  conversionSummarySchema,
  equipmentTypeSchema,
  idSchema,
  updateEquipmentTypeSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { EquipmentTypesService } from './service.js';

const params = z.object({ id: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const equipmentTypesRoutes: FastifyPluginAsyncZod<{ types: EquipmentTypesService }> = async (
  app,
  { types },
) => {
  const read = requirePermission('equipmentType.read');
  const write = requirePermission('equipmentType.write');
  const tags = ['Typy vybavení'];

  app.get(
    '/equipment-type-presets',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Knihovna typů podle norem',
        response: { 200: z.array(equipmentTypePresetSchema) },
      },
    },
    () => types.presets(),
  );
  app.get(
    '/equipment-types',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Typy vybavení',
        querystring: z.object({
          includeArchived: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        }),
        response: { 200: z.array(equipmentTypeSchema) },
      },
    },
    (req) => types.list(authOf(req), req.query.includeArchived),
  );
  app.get(
    '/equipment-types/:id',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Detail typu',
        params,
        response: { 200: equipmentTypeSchema, ...errors },
      },
    },
    (req) => types.get(authOf(req), req.params.id),
  );
  app.post(
    '/equipment-types',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Založit typ (vlastní nebo z knihovny)',
        body: createEquipmentTypeSchema,
        response: { 201: equipmentTypeSchema, ...errors },
      },
    },
    async (req, reply) => reply.code(201).send(await types.create(authOf(req), req.body)),
  );
  app.patch(
    '/equipment-types/:id',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Upravit typ (pole, číselníky, interval, text protokolu) nebo ho archivovat',
        params,
        body: updateEquipmentTypeSchema,
        response: { 200: equipmentTypeSchema, ...errors },
      },
    },
    (req) => types.update(authOf(req), req.params.id, req.body),
  );
  app.post(
    '/equipment-types/:id/conversion-preview',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Náhled převodu hodnot při změně druhu polí (nic neukládá)',
        params,
        body: conversionPreviewRequestSchema,
        response: { 200: conversionSummarySchema, ...errors },
      },
    },
    (req) => types.conversionPreview(authOf(req), req.params.id, req.body.fieldDefinitions),
  );
};
