import { defineConfig } from 'vitest/config';

// Unit tests of browser-side logic (outbox); IndexedDB comes from fake-indexeddb.
export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
});
