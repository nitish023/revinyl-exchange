import { Router } from 'express';
import { requireUser } from '../auth/middleware.js';
import { rateLimiter } from '../http/rateLimit.js';

/**
 * GET  /api/collection/discogs?username=   the vinyl in that public Discogs collection, to grade
 * POST /api/collection/discogs             { username, items: [{ instanceId, grade, sleeveGrade }] }
 *                                          -> 201 { imported, alreadyImported }
 */
export function collectionRouter(ctx, { rateLimit }) {
  const router = Router();
  // A look-up costs up to six of our shared Discogs requests (30 a minute for everyone).
  const lookups = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 6 });
  const imports = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 10 });

  router.get('/collection/discogs', requireUser, lookups, async (req, res) => {
    res.json(await ctx.collection.preview(req.user.id, req.query));
  });

  router.post('/collection/discogs', requireUser, imports, async (req, res) => {
    res.status(201).json(await ctx.collection.importItems(req.user.id, req.body));
  });

  return router;
}
