// Shohmot's site is built with Astro: pages in web/pages, shared layouts and
// components, and scripts and styles bundled, minified and hashed by Vite.
// The API stays plain Node functions in api/ (src/ holds their code).
import { defineConfig } from 'astro/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// In `astro dev`, answer /api/* with the same handlers Vercel runs.
function apiRoutes() {
  return {
    name: 'shohmot-api',
    configureServer(server) {
      const { dispatch } = require('./src/routes');
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        try {
          await dispatch(req, res);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  srcDir: './web',
  publicDir: './public',
  outDir: './dist',
  // Keep the .html addresses (/app.html, /features/review.html) so old links work.
  build: { format: 'file', inlineStylesheets: 'auto' },
  // Fetch a page as soon as its link is hovered or comes into view, and let
  // Chromium prerender it, so most clicks open instantly.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
  experimental: { clientPrerender: true },
  server: { port: Number(process.env.PORT) || 4321 },
  devToolbar: { enabled: false },
  vite: { plugins: [apiRoutes()] },
});
