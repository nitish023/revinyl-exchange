import { unauthorized } from '../errors.js';
import { findSessionUser, readCookie, SESSION_COOKIE } from './sessions.js';

/**
 * Sets req.user to the logged-in user, or null. Runs on every API request.
 * @param {import('pg').Pool} pool
 * @returns {import('express').RequestHandler}
 */
export function authenticate(pool) {
  return async (req, _res, next) => {
    try {
      req.sessionToken = readCookie(req.get('cookie'), SESSION_COOKIE);
      req.user = await findSessionUser(pool, req.sessionToken);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Put in front of routes that need a logged-in user. Answers 401 otherwise. */
export function requireUser(req, _res, next) {
  next(req.user ? undefined : unauthorized());
}
