/**
 * Sign up and log in rules, shared by the forms and the server so both give the
 * same messages.
 */
import { z } from 'zod';

export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 24;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const email = z
  .string({ error: 'Enter your email' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email')
  .max(254, 'That email is too long')
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const registerSchema = z.object({
  email,
  displayName: z
    .string({ error: 'Pick a display name' })
    .trim()
    .min(DISPLAY_NAME_MIN, `Display name needs at least ${DISPLAY_NAME_MIN} characters`)
    .max(DISPLAY_NAME_MAX, `Display name can be at most ${DISPLAY_NAME_MAX} characters`)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, - and _'),
  password: z
    .string({ error: 'Choose a password' })
    .min(PASSWORD_MIN, `Password needs at least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX, `Password can be at most ${PASSWORD_MAX} characters`),
});

export const loginSchema = z.object({
  email,
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password'),
});

/**
 * What the API sends about a user. Never includes the password hash or email of others.
 * @typedef {{ id: number, email: string, displayName: string }} User
 */
