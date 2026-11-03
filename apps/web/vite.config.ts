import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Keep the browser's Host header: the API compares it with Origin to block cross-site writes
// (the string shorthand would set changeOrigin and every write would be rejected).
const proxy = {
  '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false },
};

const shim = (name: string) => fileURLToPath(new URL(`src/demo/shims/${name}`, import.meta.url));

// `vite build --mode demo`: the GitHub Pages build with the API running in the browser on
// PGlite (ADR-0015). Node-only modules the API imports get small browser stand-ins.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: process.env.BASE_PATH ?? '/',
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    define: { 'import.meta.env.VITE_DEMO': JSON.stringify(demo ? 'true' : 'false') },
    resolve: demo
      ? {
          alias: [
            {
              find: /^(\.\/|\.\.\/api\/)transport\.js$/,
              replacement: fileURLToPath(new URL('src/demo/transport.ts', import.meta.url)),
            },
            ...Object.entries({
              'node:crypto': shim('node-crypto.ts'),
              'node:util': shim('node-util.ts'),
              'node:path': shim('node-path.ts'),
              '@node-rs/argon2': shim('argon2.ts'),
            }).map(([find, replacement]) => ({ find, replacement })),
          ],
        }
      : {},
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: {
      target: 'safari15',
      outDir: demo ? 'dist-demo' : 'dist',
      rolldownOptions: {
        // PGlite's Emscripten glue uses eval on purpose; the warning is noise.
        onLog(level, log, handler) {
          if (log.code !== 'EVAL') handler(level, log);
        },
      },
    },
  };
});
