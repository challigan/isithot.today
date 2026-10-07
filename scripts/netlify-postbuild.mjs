#!/usr/bin/env node
/**
 * The Astro Netlify adapter writes its server function and deploy config to
 * apps/web/.netlify/v1. Netlify reads `.netlify/v1` from the base directory (the repo root
 * here), so move it up after the build.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../apps/web/.netlify/v1', import.meta.url));
const to = fileURLToPath(new URL('../.netlify/v1', import.meta.url));
if (!existsSync(from)) {
  console.error(`netlify-postbuild: ${from} not found; did the Astro build run?`);
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, verbatimSymlinks: true });
console.log('netlify-postbuild: moved apps/web/.netlify/v1 to .netlify/v1');
