import { describe, expect, it } from 'vitest';
import { catalogSearchQuerySchema, releaseIdParamSchema } from './catalog.js';

describe('catalog schemas', () => {
  it('trims the query and defaults to page 1', () => {
    expect(catalogSearchQuerySchema.parse({ q: '  nirvana ' })).toEqual({ q: 'nirvana', page: 1 });
  });

  it('rejects queries that are too short or pages out of range', () => {
    expect(catalogSearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ q: 'abba', page: '0' }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ q: 'abba', page: '21' }).success).toBe(false);
  });

  it('reads the format and year filters, treating blank values as no filter', () => {
    expect(catalogSearchQuerySchema.parse({ q: 'abba', format: '7in', year: '1979' })).toEqual({
      q: 'abba',
      page: 1,
      format: '7in',
      year: 1979,
    });
    expect(catalogSearchQuerySchema.parse({ q: 'abba', format: '', year: '' })).toEqual({
      q: 'abba',
      page: 1,
    });
  });

  it('rejects unknown formats and impossible years', () => {
    expect(catalogSearchQuerySchema.safeParse({ q: 'abba', format: 'cd' }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ q: 'abba', year: '1850' }).success).toBe(false);
    expect(catalogSearchQuerySchema.safeParse({ q: 'abba', year: '19x9' }).success).toBe(false);
  });

  it('accepts only positive whole release IDs', () => {
    expect(releaseIdParamSchema.parse({ id: '249504' })).toEqual({ id: 249504 });
    expect(releaseIdParamSchema.safeParse({ id: '-1' }).success).toBe(false);
    expect(releaseIdParamSchema.safeParse({ id: '1.5' }).success).toBe(false);
    expect(releaseIdParamSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});
