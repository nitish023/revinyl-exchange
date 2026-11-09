/**
 * The Express app: security headers, JSON parsing, the API routes, and in
 * production the built client from client/dist.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { authenticate } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { catalogRouter } from './catalog/routes.js';
import { crateRouter } from './crate/routes.js';
import { errorHandler, notFound } from './errors.js';
import { sameOrigin } from './http/sameOrigin.js';
import { marketRouter } from './market/routes.js';
import { ordersRouter } from './orders/routes.js';

const CLIENT_DIST = fileURLToPath(new URL('../../client/dist/', import.meta.url));

/**
 * @param {import('./context.js').AppContext} ctx
 * @param {{ rateLimit?: boolean }} [options] tests pass rateLimit: false
 */
export function createApp(ctx, { rateLimit = true } = {}) {
  const app = express();
  // Render terminates HTTPS at its proxy; trust it so secure cookies and req.ip work.
  if (ctx.config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Render already serves HTTPS; this would break testing production mode over http.
          upgradeInsecureRequests: null,
          // Record covers load straight from Discogs' image host; data: is the paper texture.
          imgSrc: ["'self'", 'data:', 'https://i.discogs.com'],
        },
      },
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.get('/api/health', async (_req, res) => {
    const database = await ctx.pool
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false);
    res.status(database ? 200 : 503).json({ ok: database, database });
  });

  app.use('/api', authenticate(ctx.pool), sameOrigin);
  app.use('/api', authRouter(ctx, { rateLimit }));
  app.use('/api', catalogRouter(ctx, { rateLimit }));
  app.use('/api', marketRouter(ctx));
  app.use('/api', crateRouter(ctx, { rateLimit }));
  app.use('/api', ordersRouter(ctx, { rateLimit }));
  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));

  if (ctx.config.isProduction && existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }));
    // Every other path is a page in the client's router.
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: CLIENT_DIST }));
  }

  app.use(errorHandler);
  return app;
}
