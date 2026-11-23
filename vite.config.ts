import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The page asks for its scripts and styles under /truck-dispatch/, where the
// Hub will forward. The build still writes the files at the root; the Worker
// (worker/src/app.ts) removes the prefix before serving them, so the app also
// works standalone at /.
//
// CLOUDFLARE_ENV=preview|staging picks the wrangler.jsonc environment at build
// time (CI). The Cloudflare plugin is left out of the tests, which run the
// Worker's code in Node against a real local D1 (worker/src/testing/localD1.ts).
export default defineConfig(({ mode }) => ({
  base: '/truck-dispatch/',
  plugins: [react(), ...(mode === 'test' ? [] : [cloudflare()])],
  // The xlsx Fleet export fixture is imported by tests as a data URL (?inline).
  assetsInclude: ['**/*.xlsx'],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'worker/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
  },
}));
