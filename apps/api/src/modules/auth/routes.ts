import {
  apiErrorSchema,
  changePasswordRequestSchema,
  currentUserSchema,
  loginRequestSchema,
  loginResponseSchema,
} from '@revize/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SESSION_COOKIE, authOf, requireAuth } from '../../auth/plugin.js';
import type { Config } from '../../config.js';
import type { AuthService } from './service.js';

export const authRoutes: FastifyPluginAsyncZod<{ auth: AuthService; config: Config }> = async (
  app,
  { auth, config },
) => {
  const tags = ['Přihlášení'];

  app.post(
    '/auth/login',
    {
      // Brute-force protection: LOGIN_RATE_LIMIT attempts (default 10) per minute and IP.
      config: { rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Přihlášení e-mailem a heslem',
        description: 'Nastaví session cookie a vrátí i token pro hlavičku Authorization.',
        body: loginRequestSchema,
        response: { 200: loginResponseSchema, 401: apiErrorSchema, 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const result = await auth.login(request.body, { userAgent: request.headers['user-agent'] });
      reply.setCookie(SESSION_COOKIE, result.token, {
        path: '/',
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        expires: result.expiresAt,
      });
      return { user: result.user, token: result.token, expiresAt: result.expiresAt.toISOString() };
    },
  );

  app.post(
    '/auth/logout',
    {
      preHandler: requireAuth,
      schema: { tags, summary: 'Odhlášení', response: { 204: z.null() } },
    },
    async (request, reply) => {
      await auth.logout(authOf(request));
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: requireAuth,
      schema: {
        tags,
        summary: 'Přihlášený uživatel a jeho oprávnění',
        response: { 200: currentUserSchema, 401: apiErrorSchema },
      },
    },
    (request) => auth.me(authOf(request)),
  );

  app.post(
    '/auth/password',
    {
      preHandler: requireAuth,
      schema: {
        tags,
        summary: 'Změna vlastního hesla (odhlásí ostatní zařízení)',
        body: changePasswordRequestSchema,
        response: { 204: z.null(), 400: apiErrorSchema },
      },
    },
    async (request, reply) => {
      await auth.changePassword(authOf(request), request.body);
      return reply.code(204).send(null);
    },
  );
};
