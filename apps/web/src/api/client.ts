import type { ApiError } from '@revize/shared';
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

/** Same-origin JSON requests; the session cookie authenticates (ADR-0005). */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await send(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
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
  return data as T;
}

/** Multipart upload of one file (plus text fields); same error handling as JSON requests. */
export async function uploadFile<T>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file, file.name);
  let response: Response;
  try {
    response = await send(path, {
      method: 'POST',
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

/** Downloads a file the API generates (e.g. an import template) under the given name. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
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
  const url = URL.createObjectURL(await response.blob());
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
