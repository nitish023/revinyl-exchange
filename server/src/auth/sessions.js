/**
 * Login sessions. The browser keeps a random token in an httpOnly cookie; the
 * database keeps only its SHA-256 hash and an expiry date.
 */
import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'revinyl_session';
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {number} userId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
export async function createSession(db, userId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    hashToken(token),
    userId,
    expiresAt,
  ]);
  // Tidy up: expired sessions are useless, so drop this user's old ones.
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND expires_at <= $2', [userId, now]);
  return { token, expiresAt };
}

/** The logged-in user for a cookie token, or null if it's unknown or expired. */
export async function findSessionUser(db, token, now = new Date()) {
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `SELECT u.id, u.email, u.display_name
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > $2`,
    [hashToken(token), now],
  );
  return rows[0]
    ? { id: Number(rows[0].id), email: rows[0].email, displayName: rows[0].display_name }
    : null;
}

export async function deleteSession(db, token) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
}

/** Read one cookie from a Cookie header, without pulling in a cookie library. */
export function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Cookie settings: not readable by page scripts, sent only to our own site, HTTPS-only in production. */
export function sessionCookieOptions(secure, expires) {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', expires };
}
