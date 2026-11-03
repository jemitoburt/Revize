// Types of `@revize/api/demo` for the web typecheck (tsconfig `paths`). The API sources are
// typechecked in apps/api; resolving them here would pull in its Node and Fastify typings.
// Keep in sync with apps/api/src/demo/index.ts and router.ts.
import type { PGlite } from '@electric-sql/pglite';

export interface DemoMultipart {
  fields: Record<string, string>;
  file?: { filename: string; mimetype: string; data: Uint8Array };
}

export interface DemoRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string | DemoMultipart;
}

export interface DemoResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
}

export interface Migration {
  tag: string;
  sql: string;
}

export interface DemoApi {
  handle(request: DemoRequest): Promise<DemoResponse>;
}

export declare const DEMO_ADMIN: { email: string; password: string };
export declare function applyMigrations(client: PGlite, migrations: Migration[]): Promise<void>;
export declare function createDemoApi(client: PGlite, migrations: Migration[]): Promise<DemoApi>;
