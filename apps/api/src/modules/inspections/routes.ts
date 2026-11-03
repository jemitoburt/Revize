import {
  apiErrorSchema,
  closeInspectionSchema,
  idSchema,
  inspectionItemSchema,
  inspectionResultSchema,
  inspectionSchema,
  listInspectionsQuerySchema,
  recordResultSchema,
  reopenInspectionSchema,
  startInspectionSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { InspectionsService } from './service.js';

const params = z.object({ id: idSchema });
const resultParams = z.object({ id: idSchema, itemId: idSchema });
const errors = { 400: apiErrorSchema, 404: apiErrorSchema, 409: apiErrorSchema };

export const inspectionsRoutes: FastifyPluginAsyncZod<{ inspections: InspectionsService }> = async (
  app,
  { inspections },
) => {
  const read = requirePermission('inspection.read');
  const perform = requirePermission('inspection.perform');
  const tags = ['Kontroly'];

  app.get(
    '/inspections',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Seznam kontrol (nejnovější první)',
        querystring: listInspectionsQuerySchema,
        response: { 200: z.array(inspectionSchema) },
      },
    },
    (req) => inspections.list(authOf(req), req.query),
  );
  app.get(
    '/inspections/:id',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Detail kontroly',
        params,
        response: { 200: inspectionSchema, ...errors },
      },
    },
    (req) => inspections.get(authOf(req), req.params.id),
  );
  app.put(
    '/inspections/:id',
    {
      preHandler: perform,
      schema: {
        tags,
        summary: 'Zahájit kontrolu provozovny (ID volí klient, opakování nic nezmění)',
        params,
        body: startInspectionSchema,
        response: { 200: inspectionSchema, 201: inspectionSchema, ...errors },
      },
    },
    async (req, reply) => {
      const { created, inspection } = await inspections.start(authOf(req), req.params.id, req.body);
      return reply.code(created ? 201 : 200).send(inspection);
    },
  );
  app.post(
    '/inspections/:id/join',
    {
      preHandler: perform,
      schema: {
        tags,
        summary: 'Připojit se ke kontrole jako další technik',
        params,
        response: { 200: inspectionSchema, ...errors },
      },
    },
    (req) => inspections.join(authOf(req), req.params.id),
  );
  app.get(
    '/inspections/:id/items',
    {
      preHandler: read,
      schema: {
        tags,
        summary: 'Artikly kontroly s výsledky (řazeno podle umístění)',
        params,
        response: { 200: z.array(inspectionItemSchema), ...errors },
      },
    },
    (req) => inspections.items(authOf(req), req.params.id),
  );
  app.put(
    '/inspections/:id/results/:itemId',
    {
      preHandler: perform,
      schema: {
        tags,
        summary: 'Zapsat výsledek artiklu (idempotentní, platí později zapsaný)',
        params: resultParams,
        body: recordResultSchema,
        response: { 200: inspectionResultSchema, ...errors },
      },
    },
    (req) => inspections.recordResult(authOf(req), req.params.id, req.params.itemId, req.body),
  );
  app.post(
    '/inspections/:id/close',
    {
      preHandler: requirePermission('inspection.close'),
      schema: {
        tags,
        summary: 'Uzavřít kontrolu (výsledky jen pro čtení, přepočet příští kontroly artiklů)',
        params,
        body: closeInspectionSchema,
        response: { 200: inspectionSchema, ...errors },
      },
    },
    (req) => inspections.close(authOf(req), req.params.id, req.body),
  );
  app.post(
    '/inspections/:id/reopen',
    {
      preHandler: requirePermission('inspection.reopen'),
      schema: {
        tags,
        summary: 'Znovu otevřít uzavřenou kontrolu (s důvodem do auditu)',
        params,
        body: reopenInspectionSchema,
        response: { 200: inspectionSchema, ...errors },
      },
    },
    (req) => inspections.reopen(authOf(req), req.params.id, req.body.reason),
  );
  app.delete(
    '/inspections/:id/results/:itemId',
    {
      preHandler: perform,
      schema: {
        tags,
        summary: 'Zrušit výsledek artiklu (zpět na nezkontrolováno)',
        params: resultParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (req, reply) => {
      await inspections.deleteResult(authOf(req), req.params.id, req.params.itemId);
      return reply.code(204).send(null);
    },
  );
};
