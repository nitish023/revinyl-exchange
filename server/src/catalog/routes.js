import { Router } from 'express';
import { catalogSearchQuerySchema, releaseIdParamSchema } from '../../../shared/index.js';
import { rateLimiter } from '../http/rateLimit.js';

export function catalogRouter(ctx, options) {
  const router = Router();
  // Every uncached search costs one of our shared Discogs requests, so cap it per visitor.
  const searchLimiter = rateLimiter({ enabled: options.rateLimit, windowMs: 60_000, limit: 30 });

  router.get('/catalog/search', searchLimiter, async (req, res) => {
    const { q, page, format, year } = catalogSearchQuerySchema.parse(req.query);
    const filters = { ...(format ? { format } : {}), ...(year ? { year } : {}) };
    res.json(await ctx.catalog.search(q, page, filters));
  });

  router.get('/releases/:id', async (req, res) => {
    const { id } = releaseIdParamSchema.parse(req.params);
    res.json({ release: await ctx.catalog.getRelease(id) });
  });

  return router;
}
