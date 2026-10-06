#!/usr/bin/env node
/** Runs the Astro dev server in the foreground with synthetic data, for Playwright. */
import { dev } from 'astro';
import { fileURLToPath } from 'node:url';

process.env.DATA_SOURCE ??= 'synthetic';
const port = Number(process.env.E2E_PORT ?? 4322);
await dev({
  root: fileURLToPath(new URL('../', import.meta.url)),
  server: { port, host: '127.0.0.1' },
  logLevel: 'warn',
});
