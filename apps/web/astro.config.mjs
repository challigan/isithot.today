import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

// satori shapes text with harfbuzzjs, which loads hb.wasm from disk at runtime. The function
// bundler cannot see that read, so ship the file explicitly.
const harfbuzz = dirname(createRequire(require.resolve('satori')).resolve('harfbuzzjs'));
const includeFiles = [relative(root, join(harfbuzz, 'hb.wasm'))];

// Static by default; city pages, OG images and the API fallback opt in to on-demand rendering.
export default defineConfig({
  site: process.env.SITE_URL || process.env.URL || 'https://isithot.today',
  output: 'static',
  adapter: netlify({ includeFiles }),
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    server: {
      fs: { allow: ['../..'] },
      // The e2e server turns the dev error overlay off: Netlify's local edge-function
      // emulation logs unrelated errors that would otherwise cover the page under test.
      hmr: process.env.E2E ? { overlay: false } : undefined,
    },
  },
});
