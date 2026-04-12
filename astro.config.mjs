// @ts-check
import { defineConfig } from 'astro/config';

const siteUrl = (process.env.PUBLIC_SITE_URL || process.env.SITE_URL || 'https://blog.local').replace(
  /\/+$/,
  '',
);

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
  trailingSlash: 'always',
  compressHTML: true,
});
