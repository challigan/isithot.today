import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';

// Static by default; city pages and OG images opt in to on-demand rendering.
export default defineConfig({
  site: process.env.SITE_URL || process.env.URL || 'https://isithot.today',
  output: 'static',
  adapter: netlify(),
  trailingSlash: 'never',
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    server: { fs: { allow: ['../..'] } },
  },
});
