import {
  itemHistoryEntrySchema,
  apiErrorSchema,
  bulkUpdateItemsSchema,
  createItemSchema,
  idSchema,
  itemListSchema,
  itemSchema,
  listItemsQuerySchema,
  updateItemSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { ItemsService } from './service.js';

const params = z.object({ id: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const itemsRoutes: FastifyPluginAsyncZod<{ items: ItemsService }> = async (
  app,
  { items },
) => {
  const read = requirePermission('item.read');
  const write = requirePermission('item.write');
  const tags = ['Artikly'];

  app.get(
    '/items',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Artikly s filtry, vyhledáváním a řazením',
        querystring: listItemsQuerySchema,
        response: { 200: itemListSchema },
      },
    },
    (req) => items.list(authOf(req), req.query),
  );
  app.get(
    '/items/:id',
    {
      preHandler: read,
      schema: { tags, summary: 'Detail artiklu', params, response: { 200: itemSchema, ...errors } },
    },
    (req) => items.get(authOf(req), req.params.id),
  );
  app.get(
    '/items/:id/history',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Historie kontrol artiklu (i kontroly, ve kterých nebyl zkontrolován)',
        params,
        response: { 200: z.array(itemHistoryEntrySchema), ...errors },
      },
    },
    (req) => items.history(authOf(req), req.params.id),
  );
  app.post(
    '/items',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Založit artikl (bez čísla = další volné číslo zákazníka)',
        body: createItemSchema,
        response: { 201: itemSchema, ...errors },
      },
    },
    async (req, reply) => reply.code(201).send(await items.create(authOf(req), req.body)),
  );
  app.patch(
    '/items/:id',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Upravit artikl (změna stavu vyžaduje důvod)',
        params,
        body: updateItemSchema,
        response: { 200: itemSchema, ...errors },
      },
    },
    (req) => items.update(authOf(req), req.params.id, req.body),
  );
  app.post(
    '/items/bulk-update',
    {
      preHandler: write,
      schema: {
        tags,
        summary: 'Hromadná změna (umístění, stav, příští kontrola, vyřazení z evidence)',
        body: bulkUpdateItemsSchema,
        response: { 200: z.object({ updated: z.number().int() }), ...errors },
      },
    },
    (req) => items.bulkUpdate(authOf(req), req.body),
  );
};
