import type { ApiError } from '@revize/shared';
import { localDb } from '../platform/local-db.js';
import { send } from './transport.js';

/** Error returned by the API: machine code, Czech message, optional per-field issues. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }

  get code() {
    return this.body.error;
  }

  /** Field errors keyed by path ("fieldValues.rungs") for forms. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const issue of this.body.issues ?? []) {
      const key = issue.path.join('.');
      errors[key] ??= issue.message;
    }
    return errors;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** True in the GitHub Pages build, where the API runs inside the browser (ADR-0015). */
export const DEMO = import.meta.env.VITE_DEMO === 'true';

/** Reads the field mode needs without a connection (ADR-0004): the last answer is kept. */
const OFFLINE_READS = [
  '/auth/me',
  '/inspections',
  '/equipment-types',
  '/customers',
  '/sites',
  '/photos',
];
const offlineReadable = (method: Method, path: string) =>
  method === 'GET' && OFFLINE_READS.some((prefix) => path.startsWith(prefix));

/** Forgets the stored copy of a read (e.g. the signed-in user after logout). */
export async function forgetSnapshot(path: string): Promise<void> {
  await localDb.snapshots.delete(`GET ${path}`).catch(() => undefined);
}

/**
 * Same-origin JSON requests; the session cookie authenticates (ADR-0005). Without a connection
 * the reads listed in `OFFLINE_READS` answer from the copy stored on the device.
 */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const snapshotKey = `GET ${path}`;
  let response: Response;
  try {
    response = await send(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    if (offlineReadable(method, path)) {
      const stored = await localDb.snapshots.get(snapshotKey).catch(() => undefined);
      if (stored) return stored.value as T;
    }
    throw new ApiRequestError(0, {
      error: 'network',
      message: 'Server není dostupný. Zkontrolujte připojení.',
    });
  }
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      data && typeof data === 'object' && 'error' in data
        ? (data as ApiError)
        : { error: 'http_' + response.status, message: `Chyba serveru (${response.status}).` };
    throw new ApiRequestError(response.status, error);
  }
  if (offlineReadable(method, path)) {
    void localDb.snapshots
      .put({ key: snapshotKey, value: data, savedAt: new Date().toISOString() })
      .catch(() => undefined);
  }
  return data as T;
}

/** Multipart upload of one file (plus text fields); same error handling as JSON requests. */
export async function uploadFile<T>(
  path: string,
  file: Blob,
  fields: Record<string, string> = {},
  options: { method?: 'POST' | 'PUT'; fileName?: string } = {},
): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file, options.fileName ?? (file instanceof File ? file.name : 'soubor'));
  let response: Response;
  try {
    response = await send(path, {
      method: options.method ?? 'POST',
      credentials: 'same-origin',
      body: form,
    });
  } catch {
    throw new ApiRequestError(0, {
      error: 'network',
      message: 'Server není dostupný. Zkontrolujte připojení.',
    });
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      data && typeof data === 'object' && 'error' in data
        ? (data as ApiError)
        : { error: `http_${response.status}`, message: `Chyba serveru (${response.status}).` },
    );
  }
  return data as T;
}

/** A file from the API (photo, generated document) as a Blob. */
export async function fetchBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await send(path, { method: 'GET', credentials: 'same-origin' });
  } catch {
    throw new ApiRequestError(0, {
      error: 'network',
      message: 'Server není dostupný. Zkontrolujte připojení.',
    });
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiRequestError(
      response.status,
      data && typeof data === 'object' && 'error' in data
        ? (data as ApiError)
        : { error: `http_${response.status}`, message: `Chyba serveru (${response.status}).` },
    );
  }
  return response.blob();
}

/** Downloads a file the API generates (e.g. an import template) under the given name. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: (path: string) => request<void>('DELETE', path),
};

export function queryString(
  params: Record<string, string | number | boolean | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
