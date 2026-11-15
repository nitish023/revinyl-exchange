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
  // A look-up can cost up to six of the 30 Discogs requests a minute every visitor shares
  // (repeats within 10 minutes come from our cache), so two a minute per account.
  const lookups = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 2, perUser: true });
  const imports = rateLimiter({ enabled: rateLimit, windowMs: 60_000, limit: 10, perUser: true });

  router.get('/collection/discogs', requireUser, lookups, async (req, res) => {
    res.json(await ctx.collection.preview(req.user.id, req.query));
  });

  router.post('/collection/discogs', requireUser, imports, async (req, res) => {
    res.status(201).json(await ctx.collection.importItems(req.user.id, req.body));
  });

  return router;
}
