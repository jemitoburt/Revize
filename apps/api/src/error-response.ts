import type { ApiError } from '@revize/shared';
import type { FastifyError } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from './errors.js';

export interface ErrorResponse {
  statusCode: number;
  body: ApiError;
}

/**
 * Maps any error thrown while handling a request to the API error body. Used by the Fastify
 * error handler and by the in-browser demo runtime, so both answer errors identically.
 */
export function errorResponse(
  error: FastifyError | Error,
  log: (error: unknown, message?: string) => void,
): ErrorResponse {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      statusCode: 400,
      body: {
        error: 'validation',
        message: 'Zadané údaje nejsou platné.',
        issues: error.validation.map((v) => ({
          path: v.instancePath.split('/').filter(Boolean),
          message: v.message ?? 'Neplatná hodnota',
        })),
      },
    };
  }
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      },
    };
  }
  const statusCode = 'statusCode' in error ? (error.statusCode ?? 500) : 500;
  if (statusCode === 429) {
    return {
      statusCode,
      body: { error: 'rate_limited', message: 'Příliš mnoho pokusů. Zkuste to za chvíli.' },
    };
  }
  if (isResponseSerializationError(error as FastifyError)) {
    log({ issues: (error.cause as { issues?: unknown }).issues }, 'response does not match schema');
  } else if (statusCode < 500) {
    return { statusCode, body: { error: 'bad_request', message: error.message } };
  } else {
    log(error);
  }
  return { statusCode: 500, body: { error: 'internal', message: 'Neočekávaná chyba serveru.' } };
}
