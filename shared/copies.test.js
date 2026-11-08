import { describe, expect, it } from 'vitest';
import {
  CONDITION_FLAG_CODES,
  conditionFlagLabel,
  conditionText,
  STARTING_CASH_CENTS,
} from './copies.js';

describe('conditionText', () => {
  it('writes record grade then sleeve grade', () => {
    expect(conditionText(6, 5)).toBe('VG+/VG');
    expect(conditionText(8, 8)).toBe('M/M');
  });

  it('says when the sleeve is generic or missing', () => {
    expect(conditionText(7, null)).toBe('NM, generic sleeve');
    expect(conditionText(7, undefined)).toBe('NM, generic sleeve');
  });

  it('throws on a grade that does not exist (a bug, not user input)', () => {
    expect(() => conditionText(9, 5)).toThrow(RangeError);
    expect(() => conditionText(6, 0)).toThrow(RangeError);
  });
});

describe('condition flags', () => {
  it('has a label for every code', () => {
    for (const code of CONDITION_FLAG_CODES) expect(conditionFlagLabel(code)).toBeTruthy();
    expect(conditionFlagLabel('nope')).toBeNull();
  });

  it('matches the list the database allows (migration 003)', () => {
    expect(CONDITION_FLAG_CODES).toEqual([
      'warp',
      'skips',
      'groove_wear',
      'ring_wear',
      'seam_split',
      'label_writing',
    ]);
  });
});

it('starts everyone with $2,000', () => {
  expect(STARTING_CASH_CENTS).toBe(200_000);
});
