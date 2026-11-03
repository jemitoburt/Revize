import {
  apiErrorSchema,
  createUserRequestSchema,
  idSchema,
  updateUserRequestSchema,
  userSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { authOf, requirePermission } from '../../auth/plugin.js';
import type { UsersService } from './service.js';

export const usersRoutes: FastifyPluginAsyncZod<{ users: UsersService }> = async (
  app,
  { users },
) => {
  const tags = ['Uživatelé'];
  const guard = requirePermission('user.manage');

  app.get(
    '/users',
    {
      preHandler: guard,
      schema: { tags, summary: 'Seznam uživatelů', response: { 200: z.array(userSchema) } },
    },
    (request) => users.list(authOf(request)),
  );

  app.post(
    '/users',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Založit uživatele',
        body: createUserRequestSchema,
        response: { 201: userSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await users.create(authOf(request), request.body)),
  );

  app.patch(
    '/users/:id',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Upravit uživatele (role, aktivní, reset hesla)',
        params: z.object({ id: idSchema }),
        body: updateUserRequestSchema,
        response: { 200: userSchema, 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    (request) => users.update(authOf(request), request.params.id, request.body),
  );

  app.delete(
    '/users/:id',
    {
      preHandler: guard,
      schema: {
        tags,
        summary: 'Smazat uživatele (historie kontrol a audit zůstávají)',
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 404: apiErrorSchema, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      await users.remove(authOf(request), request.params.id);
      return reply.code(204).send(null);
    },
  );
};
