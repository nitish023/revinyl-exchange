/**
 * Password hashing with scrypt from Node's built-in crypto (no native packages
 * to compile on Render). Each hash carries its own salt and settings:
 *   scrypt$N$r$p$<salt>$<hash>   (salt and hash in base64)
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const SETTINGS = { N: 16_384, r: 8, p: 1 };

/** @param {string} password */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, SETTINGS);
  const { N, r, p } = SETTINGS;
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * @param {string} password
 * @param {string} stored a value from hashPassword
 */
export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scryptAsync(
    password.normalize('NFKC'),
    Buffer.from(salt, 'base64'),
    expected.length,
    {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    },
  );
  return timingSafeEqual(actual, expected);
}

/** Checked when an email has no account, so "no such user" takes as long as "wrong password". */
export const DUMMY_HASH = await hashPassword('not-a-real-password');
