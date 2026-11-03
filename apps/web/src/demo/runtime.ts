import './shims/buffer-global.js';
import { PGlite } from '@electric-sql/pglite';
import {
  createDemoApi,
  type DemoApi,
  type DemoRequest,
  type ImageProcessor,
  type Migration,
} from '@revize/api/demo';
import { resizeToJpeg } from '../lib/images.js';

/** The demo's PostgreSQL database lives in this browser's IndexedDB under this name. */
const DATABASE_NAME = 'revize-demo';
const COOKIE_KEY = 'revize-demo-cookie';

const sqlFiles = import.meta.glob<string>('../../../api/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const migrations: Migration[] = Object.entries(sqlFiles).map(([path, sql]) => ({
  tag: path
    .split('/')
    .pop()!
    .replace(/\.sql$/, ''),
  sql,
}));

/** Thumbnails in the browser instead of sharp. */
const canvasImages: ImageProcessor = {
  async process(data, thumbnailSize) {
    try {
      const { blob, width, height } = await resizeToJpeg(
        new Blob([new Uint8Array(data)]),
        thumbnailSize,
        0.75,
      );
      return { width, height, thumbnail: new Uint8Array(await blob.arrayBuffer()) };
    } catch {
      return null;
    }
  },
};

let started: Promise<{ client: PGlite; api: DemoApi }> | null = null;

function demo() {
  started ??= PGlite.create(`idb://${DATABASE_NAME}`).then(async (client) => ({
    client,
    api: await createDemoApi(client, migrations, canvasImages),
  }));
  return started;
}

function readCookie(): string {
  try {
    return localStorage.getItem(COOKIE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeCookie(header: string) {
  const [pair = ''] = header.split(';');
  try {
    if (pair.endsWith('=')) localStorage.removeItem(COOKIE_KEY);
    else localStorage.setItem(COOKIE_KEY, pair);
  } catch {
    // Private mode: the session lasts until the page is closed.
  }
}

async function bodyOf(body: BodyInit | null | undefined): Promise<DemoRequest['body']> {
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof FormData) {
    const fields: Record<string, string> = {};
    let file: { filename: string; mimetype: string; data: Uint8Array } | undefined;
    for (const [name, value] of body) {
      if (typeof value === 'string') fields[name] = value;
      else {
        file = {
          filename: value.name,
          mimetype: value.type,
          data: new Uint8Array(await value.arrayBuffer()),
        };
      }
    }
    return { fields, ...(file ? { file } : {}) };
  }
  throw new Error('Demo: unsupported request body');
}

/**
 * `fetch` for `/api/...` answered by the API running in this browser (ADR-0015). The session
 * cookie is kept in localStorage, so the demo stays signed in like the real app.
 */
export async function demoFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  new Headers(init.headers).forEach((value, key) => (headers[key] = value));
  const cookie = readCookie();
  if (cookie) headers.cookie = cookie;
  const { api } = await demo();
  const response = await api.handle({
    method: init.method ?? 'GET',
    url: input,
    headers,
    body: await bodyOf(init.body),
  });
  const { 'set-cookie': setCookie, ...responseHeaders } = response.headers;
  if (setCookie) storeCookie(setCookie);
  const body =
    response.body instanceof Uint8Array ? new Blob([new Uint8Array(response.body)]) : response.body;
  return new Response(response.status === 204 ? null : body, {
    status: response.status,
    headers: responseHeaders,
  });
}

/** Deletes the demo database; the next request starts again with fresh demo data. */
export async function resetDemo(): Promise<void> {
  if (started) await (await started).client.close();
  started = null;
  try {
    localStorage.removeItem(COOKIE_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(`/pglite/${DATABASE_NAME}`);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
