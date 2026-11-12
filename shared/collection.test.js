import { describe, expect, it } from 'vitest';
import {
  collectionImportSchema,
  discogsUsernameSchema,
  gradeFromDiscogs,
  MAX_IMPORT,
} from './collection.js';

describe('gradeFromDiscogs', () => {
  it('reads every grade on Discogs’ condition lists', () => {
    expect(gradeFromDiscogs('Mint (M)')).toBe(8);
    expect(gradeFromDiscogs('Near Mint (NM or M-)')).toBe(7);
    expect(gradeFromDiscogs('Very Good Plus (VG+)')).toBe(6);
    expect(gradeFromDiscogs('Very Good (VG)')).toBe(5);
    expect(gradeFromDiscogs('Good Plus (G+)')).toBe(4);
    expect(gradeFromDiscogs('Good (G)')).toBe(3);
    expect(gradeFromDiscogs('Fair (F)')).toBe(2);
    expect(gradeFromDiscogs('Poor (P)')).toBe(1);
  });

  it('treats a generic or missing sleeve as no sleeve grade', () => {
    expect(gradeFromDiscogs('Generic')).toBeNull();
    expect(gradeFromDiscogs('No Cover')).toBeNull();
  });

  it('leaves anything else for the person to grade', () => {
    expect(gradeFromDiscogs('Not Graded')).toBeUndefined();
    expect(gradeFromDiscogs('pretty good')).toBeUndefined();
    expect(gradeFromDiscogs('Shiny (S)')).toBeUndefined();
    expect(gradeFromDiscogs('')).toBeUndefined();
    expect(gradeFromDiscogs(undefined)).toBeUndefined();
  });
});

describe('the import request', () => {
  const item = (instanceId, grade = 6, sleeveGrade = null) => ({ instanceId, grade, sleeveGrade });

  it('accepts records with grades', () => {
    const parsed = collectionImportSchema.parse({
      username: ' digger_42 ',
      items: [item(1), item(2, 7, 5)],
    });
    expect(parsed.username).toBe('digger_42');
    expect(parsed.items).toHaveLength(2);
  });

  it('needs a grade for every record and no record twice', () => {
    expect(
      collectionImportSchema.safeParse({
        username: 'a',
        items: [{ instanceId: 1, sleeveGrade: null }],
      }).success,
    ).toBe(false);
    expect(
      collectionImportSchema.safeParse({ username: 'a', items: [item(1), item(1)] }).success,
    ).toBe(false);
    expect(collectionImportSchema.safeParse({ username: 'a', items: [] }).success).toBe(false);
  });

  it('caps one import at the contract’s 100 records', () => {
    const items = Array.from({ length: MAX_IMPORT + 1 }, (_, index) => item(index + 1));
    expect(collectionImportSchema.safeParse({ username: 'a', items }).success).toBe(false);
  });

  it('only takes usernames Discogs could have', () => {
    expect(discogsUsernameSchema.safeParse('rodney.fool-2').success).toBe(true);
    expect(discogsUsernameSchema.safeParse('../admin').success).toBe(false);
    expect(discogsUsernameSchema.safeParse('a b').success).toBe(false);
  });
});
