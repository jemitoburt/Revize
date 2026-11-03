import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { useCzechValidationMessages } from '@revize/shared';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authPlugin } from './auth/plugin.js';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { errorResponse } from './error-response.js';
import { registerApiRoutes } from './routes.js';

export interface AppDeps {
  config: Config;
  db: Db;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, db, logger }: AppDeps) {
  useCzechValidationMessages();

  const app = Fastify({
    logger: logger ?? { level: config.LOG_LEVEL },
    // Behind Caddy: use X-Forwarded-* for client IP (rate limiting) and host (origin check).
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const { statusCode, body } = errorResponse(error, (detail, message) =>
      request.log.error(detail, message),
    );
    return reply.code(statusCode).send(body);
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { files: 1, fields: 5 } });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Revize API',
        description:
          'API systému pro evidenci a kontrolu technického vybavení. Autentizace session cookie ' +
          'nebo hlavičkou `Authorization: Bearer <token>` z odpovědi `/api/auth/login`.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          cookieAuth: { type: 'apiKey', in: 'cookie', name: 'revize_session' },
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  await app.register(authPlugin, { db, config });

  await app.register((api) => registerApiRoutes(api, { db, config }), { prefix: '/api' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
