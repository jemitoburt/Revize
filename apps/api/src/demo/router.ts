import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { errorResponse } from '../error-response.js';

/** A request as the browser's fetch would send it to `/api/...`. */
export interface DemoRequest {
  method: string;
  /** Path with query string, e.g. `/api/items?siteId=…`. */
  url: string;
  headers?: Record<string, string>;
  /** JSON text, or the parts of a multipart form. */
  body?: string | DemoMultipart;
}

export interface DemoMultipart {
  fields: Record<string, string>;
  file?: { filename: string; mimetype: string; data: Uint8Array };
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  /** Serialized JSON, raw bytes (downloads) or nothing (204). */
  body: string | Uint8Array | null;
}

interface RouteSchema {
  params?: z.ZodType;
  querystring?: z.ZodType;
  body?: z.ZodType;
  response?: Record<number, z.ZodType>;
}

type Hook = (request: DemoFastifyRequest, reply: DemoReply) => unknown;
type Handler = (request: DemoFastifyRequest, reply: DemoReply) => unknown;

interface RouteOptions {
  schema?: RouteSchema;
  preHandler?: Hook | Hook[];
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  url: string;
  options: RouteOptions;
  handler: Handler;
}

interface DemoFastifyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  params: unknown;
  query: unknown;
  body: unknown;
  auth: unknown;
  file: (options?: { limits?: { fileSize?: number } }) => Promise<unknown>;
}

interface Cookie {
  name: string;
  value: string;
  clear: boolean;
}

class DemoReply {
  statusCode = 200;
  headers: Record<string, string> = {};
  cookies: Cookie[] = [];
  sent = false;
  payload: unknown;

  code(statusCode: number) {
    this.statusCode = statusCode;
    return this;
  }
  header(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  setCookie(name: string, value: string) {
    this.cookies.push({ name, value, clear: false });
    return this;
  }
  clearCookie(name: string) {
    this.cookies.push({ name, value: '', clear: true });
    return this;
  }
  send(payload: unknown) {
    this.sent = true;
    this.payload = payload;
    return this;
  }
}

/**
 * Just enough of Fastify to run the API route plugins in a browser (ADR-0015): routing with
 * prefixes, `onRequest` hooks, preHandlers, the same zod validator and serializer as the server,
 * cookies and single-file multipart. Anything a plugin needs beyond that fails loudly in tests.
 */
export class DemoRouter {
  private readonly routes: Route[] = [];
  private readonly onRequest: Hook[] = [];

  /** The object handed to route plugins in place of a Fastify instance. */
  instance(prefix = ''): FastifyInstance {
    const add = (method: string) => (url: string, options: RouteOptions, handler: Handler) =>
      this.add(method, prefix + url, options, handler);
    const app = {
      get: add('GET'),
      post: add('POST'),
      put: add('PUT'),
      patch: add('PATCH'),
      delete: add('DELETE'),
      register: async (
        plugin: (app: FastifyInstance, options: Record<string, unknown>) => unknown,
        options: Record<string, unknown> & { prefix?: string } = {},
      ) => {
        await plugin(this.instance(prefix + (options.prefix ?? '')), options);
      },
      decorateRequest: () => app,
      addHook: (name: string, hook: Hook) => {
        if (name !== 'onRequest') throw new Error(`Demo runtime: hook ${name} not supported`);
        this.onRequest.push(hook);
        return app;
      },
    };
    return app as unknown as FastifyInstance;
  }

  private add(method: string, url: string, options: RouteOptions, handler: Handler) {
    const keys: string[] = [];
    const source = url
      .split('/')
      .map((part) => {
        if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        keys.push(part.slice(1));
        return '([^/]+)';
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, url, options, handler });
  }

  async handle(input: DemoRequest): Promise<DemoResponse> {
    const reply = new DemoReply();
    try {
      const [path = '', search = ''] = input.url.split('?');
      const method = input.method.toUpperCase();
      let match: RegExpExecArray | null = null;
      const route = this.routes.find(
        (r) => r.method === method && (match = r.pattern.exec(path)) !== null,
      );
      if (!route || !match) {
        return json(404, { error: 'not_found', message: `Route ${method}:${path} not found` });
      }
      const groups: string[] = match;
      const params = Object.fromEntries(
        route.keys.map((key, i) => [key, decodeURIComponent(groups[i + 1]!)]),
      );
      const headers = Object.fromEntries(
        Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
      );
      const request: DemoFastifyRequest = {
        method,
        url: input.url,
        headers,
        cookies: parseCookies(headers.cookie),
        params,
        query: parseQuery(search),
        body:
          typeof input.body === 'string' && input.body !== '' ? JSON.parse(input.body) : undefined,
        auth: null,
        file: async (options) => fileOf(input.body, options?.limits?.fileSize),
      };

      for (const hook of this.onRequest) await hook(request, reply);
      const schema = route.options.schema ?? {};
      request.params = validate(schema.params, request.params);
      request.query = validate(schema.querystring, request.query);
      request.body = validate(schema.body, request.body);
      const preHandlers = [route.options.preHandler ?? []].flat();
      for (const hook of preHandlers) await hook(request, reply);

      const result = await route.handler(request, reply);
      const payload = reply.sent ? reply.payload : result;
      return serialize(route, reply, payload);
    } catch (error) {
      const { statusCode, body } = errorResponse(error as Error, (detail, message) =>
        console.error(message ?? 'demo api error', detail),
      );
      return withCookies(json(statusCode, body), reply);
    }
  }
}

function validate(schema: z.ZodType | undefined, data: unknown) {
  if (!schema) return data;
  const result = validatorCompiler({ schema } as never)(data) as
    { value: unknown } | { error: unknown[] };
  if ('error' in result) throw Object.assign(new Error('validation'), { validation: result.error });
  return result.value;
}

function serialize(route: Route, reply: DemoReply, payload: unknown): DemoResponse {
  const status = reply.statusCode;
  const schema = route.options.schema?.response?.[status];
  let response: DemoResponse;
  if (status === 204 || payload === undefined) {
    response = { status, headers: { ...reply.headers }, body: null };
  } else if (payload instanceof Uint8Array) {
    response = { status, headers: { ...reply.headers }, body: payload };
  } else if (typeof payload === 'string' && reply.headers['content-type'] && !schema) {
    // Text the route sent with its own content type (e.g. the protocol HTML).
    response = { status, headers: { ...reply.headers }, body: payload };
  } else {
    const body = schema
      ? (
          serializerCompiler({ schema, method: route.method, url: route.url } as never) as (
            data: unknown,
          ) => string
        )(payload)
      : JSON.stringify(payload);
    response = {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...reply.headers },
      body,
    };
  }
  return withCookies(response, reply);
}

function withCookies(response: DemoResponse, reply: DemoReply): DemoResponse {
  if (reply.cookies.length === 0) return response;
  // One header per response is enough for the demo: the session cookie is the only one.
  const cookie = reply.cookies.at(-1)!;
  response.headers['set-cookie'] = cookie.clear
    ? `${cookie.name}=; Max-Age=0`
    : `${cookie.name}=${cookie.value}`;
  return response;
}

function json(status: number, body: unknown): DemoResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return cookies;
}

function parseQuery(search: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else query[key] = [existing, value].flat();
  }
  return query;
}

function fileOf(body: DemoRequest['body'], maxBytes: number | undefined) {
  if (!body || typeof body === 'string' || !body.file) return undefined;
  const { file, fields } = body;
  return {
    filename: file.filename,
    mimetype: file.mimetype,
    fields: Object.fromEntries(
      Object.entries(fields).map(([name, value]) => [name, { type: 'field', value }]),
    ),
    toBuffer: async () => {
      if (maxBytes !== undefined && file.data.byteLength > maxBytes) {
        throw new Error('file too large');
      }
      return Buffer.from(file.data);
    },
  };
}
