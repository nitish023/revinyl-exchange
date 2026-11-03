import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth.js';
import { fieldErrors } from './validation.js';

describe('registerSchema', () => {
  it('trims and lower-cases the email', () => {
    const parsed = registerSchema.parse({
      email: '  Nitish@Example.COM ',
      displayName: 'crate_digger',
      password: 'long enough',
    });
    expect(parsed.email).toBe('nitish@example.com');
  });

  it('explains every problem, one message per field', () => {
    const result = registerSchema.safeParse({
      email: 'nope',
      displayName: 'ab',
      password: 'short',
    });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error)).toEqual({
      email: 'Enter a valid email address',
      displayName: 'Display name needs at least 3 characters',
      password: 'Password needs at least 8 characters',
    });
  });

  it('allows only letters, numbers, - and _ in display names', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.co',
      displayName: 'crate digger',
      password: 'long enough',
    });
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error).displayName).toBe('Use only letters, numbers, - and _');
  });
});

describe('loginSchema', () => {
  it('needs an email and a password', () => {
    const result = loginSchema.safeParse({ email: '', password: '' });
    expect(Object.keys(fieldErrors(result.error)).sort()).toEqual(['email', 'password']);
  });
});
