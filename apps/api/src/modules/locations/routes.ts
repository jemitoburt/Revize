import {
  apiErrorSchema,
  createLocationSchema,
  createLocationSeriesSchema,
  idSchema,
  locationSchema,
  updateLocationSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { LocationsService } from './service.js';

const params = z.object({ id: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const locationsRoutes: FastifyPluginAsyncZod<{ locations: LocationsService }> = async (
  app,
  { locations },
) => {
  const read = requirePermission('customer.read');
  const write = requirePermission('customer.write');
  const add = requirePermission('location.create');
  const tags = ['Umístění'];

  app.get(
    '/sites/:id/locations',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Strom umístění provozovny (v pořadí stromu)',
        params,
        querystring: z.object({
          includeArchived: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        }),
        response: { 200: z.array(locationSchema), ...errors },
      },
    },
    (req) => locations.list(authOf(req), req.params.id, req.query.includeArchived),
  );
  app.post(
    '/sites/:id/locations',
    {
      preHandler: add,
      schema: {
        tags,
        summary: 'Založit umístění',
        params,
        body: createLocationSchema,
        response: { 201: locationSchema, ...errors },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await locations.create(authOf(req), req.params.id, req.body)),
  );
  app.post(
    '/sites/:id/locations/series',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Založit řadu umístění (např. Pozice 1–20)',
        params,
        body: createLocationSeriesSchema,
        response: { 201: z.array(locationSchema), ...errors },
      },
    },
    async (req, reply) =>
      reply.code(201).send(await locations.createSeries(authOf(req), req.params.id, req.body)),
  );
  app.patch(
    '/locations/:id',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Přejmenovat, přesunout, přeřadit nebo archivovat umístění',
        params,
        body: updateLocationSchema,
        response: { 200: locationSchema, ...errors },
      },
    },
    (req) => locations.update(authOf(req), req.params.id, req.body),
  );
};
