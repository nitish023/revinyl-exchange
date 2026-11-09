import express, { Router } from 'express';
import {
  crateQuerySchema,
  idParamSchema,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  photoParamSchema,
} from '../../../shared/index.js';
import { requireUser } from '../auth/middleware.js';
import { addCopy, addPhoto, findPhoto, listCrate, removeCopy } from './crateService.js';

/**
 * GET    /api/crate?releaseId=                 my copies
 * POST   /api/crate                            add a copy -> 201 { copy }
 * DELETE /api/crate/:id                        remove a copy that's in the crate -> 204
 * POST   /api/crate/:id/photos                 the image itself as the body -> 201 { photo }
 * GET    /api/copies/:id/photos/:position      the image (anyone: photos are shown on ads)
 */
export function crateRouter(ctx) {
  const router = Router();
  // Only image bodies are read, and only after the login check, so nobody can make the
  // server buffer 2 MB without being logged in.
  const photoBody = express.raw({ type: [...PHOTO_TYPES], limit: MAX_PHOTO_BYTES });

  router.get('/crate', requireUser, async (req, res) => {
    const { releaseId } = crateQuerySchema.parse(req.query);
    res.json({ copies: await listCrate(ctx.pool, req.user.id, releaseId) });
  });

  router.post('/crate', requireUser, async (req, res) => {
    res.status(201).json({ copy: await addCopy(ctx, req.user.id, req.body) });
  });

  router.delete('/crate/:id', requireUser, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await removeCopy(ctx.pool, req.user.id, id);
    res.status(204).end();
  });

  router.post('/crate/:id/photos', requireUser, photoBody, async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.status(201).json({ photo: await addPhoto(ctx.pool, req.user.id, id, req.body) });
  });

  router.get('/copies/:id/photos/:position', async (req, res) => {
    const { id, position } = photoParamSchema.parse(req.params);
    const photo = await findPhoto(ctx.pool, id, position);
    res.set('Content-Type', photo.contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(photo.bytes);
  });

  return router;
}
