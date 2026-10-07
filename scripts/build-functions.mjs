#!/usr/bin/env node
/**
 * Bundles the shared server code (@isithot/server and everything it imports, including
 * @netlify/blobs and the data files) into one self-contained module for the Netlify
 * Functions. Netlify's packager for modern functions leaves workspace packages as external
 * imports and does not ship their TypeScript sources, so the functions import this bundle
 * by relative path instead.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ['packages/server/src/index.ts'],
  outfile: 'functions/lib/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some dependencies use require(); give the ESM bundle a working one.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
