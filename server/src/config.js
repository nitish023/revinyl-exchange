/**
 * Settings from environment variables, checked once at startup so a missing or
 * malformed value fails loudly instead of halfway through a request.
 * Locally they come from .env (see .env.example); on Render, from the dashboard.
 */
import { z } from 'zod';

const blankAsMissing = (value) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  DATABASE_URL: z.string({ error: 'DATABASE_URL is required (see .env.example)' }).min(1),
  DISCOGS_TOKEN: z.preprocess(blankAsMissing, z.string().trim().optional()),
  DISCOGS_USER_AGENT: z.preprocess(blankAsMissing, z.string().default('reVINYL/0.1')),
  CATALOG_MAX_AGE_HOURS: z.preprocess(blankAsMissing, z.coerce.number().positive().default(6)),
  DISCOGS_REQUESTS_PER_MINUTE: z.preprocess(
    blankAsMissing,
    // Discogs allows 60 a minute for the whole site; we stay under it.
    z.coerce.number().int().min(1).max(60).default(30),
  ),
});

/**
 * @typedef {z.infer<typeof schema> & { isProduction: boolean }} Config
 */

/** @returns {Config} */
export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment settings:\n${problems.join('\n')}`);
  }
  return { ...result.data, isProduction: result.data.NODE_ENV === 'production' };
}
