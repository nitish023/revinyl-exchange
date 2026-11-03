import { AppError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const crossSite = () => new AppError(403, 'CROSS_SITE', 'That request came from another website');

/**
 * Blocks requests that change something (POST, PUT, DELETE…) when they come from
 * another website. Together with the SameSite=Lax session cookie, this stops
 * another site from logging you out or placing orders on your behalf (CSRF).
 *
 * Modern browsers say where a request came from in Sec-Fetch-Site; we trust that
 * when it's there (it also works behind the Vite dev proxy, which rewrites Host).
 * Older browsers only send Origin, which must match our Host. Tools like curl and
 * our tests send neither and are allowed.
 * @type {import('express').RequestHandler}
 */
export function sameOrigin(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite) {
    return next(fetchSite === 'same-origin' || fetchSite === 'none' ? undefined : crossSite());
  }
  const origin = req.get('origin');
  if (!origin) return next();
  let host = null;
  try {
    host = new URL(origin).host;
  } catch {
    // a malformed Origin is treated as foreign
  }
  next(host === req.get('host') ? undefined : crossSite());
}
