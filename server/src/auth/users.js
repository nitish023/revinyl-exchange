import { AppError } from '../errors.js';
import { hashPassword } from './passwords.js';

/** @returns {import('../../../shared/auth.js').User} */
export function toUser(row) {
  return { id: Number(row.id), email: row.email, displayName: row.display_name };
}

/**
 * Create an account. Fails with a per-field 409 if the email or display name is taken.
 * @param {import('pg').Pool} db
 * @param {{ email: string, displayName: string, password: string }} input already validated
 */
export async function registerUser(db, input) {
  const passwordHash = await hashPassword(input.password);
  try {
    const { rows } = await db.query(
      `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [input.email, input.displayName, passwordHash],
    );
    return toUser(rows[0]);
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_email_key') {
      throw new AppError(409, 'EMAIL_TAKEN', 'That email already has an account', {
        email: 'That email already has an account. Try logging in.',
      });
    }
    if (error.code === '23505' && error.constraint === 'users_display_name_key') {
      throw new AppError(409, 'NAME_TAKEN', 'That display name is taken', {
        displayName: 'That display name is taken. Try another.',
      });
    }
    throw error;
  }
}

export async function findUserByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id, email, display_name, password_hash FROM users WHERE email = $1',
    [email],
  );
  return rows[0] ? { ...toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}
