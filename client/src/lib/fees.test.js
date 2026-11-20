import { describe, expect, it } from 'vitest';
import { payoutLine, standingText } from './fees.js';

const standing = (overrides = {}) => ({
  level: 2,
  fee: '11.5%',
  sales90: 3,
  volume90: '120.00',
  next: { level: 3, salesNeeded: 7, volumeNeeded: '380.00', reliabilityNeeded: 0, fee: '11%' },
  ...overrides,
});

describe('payoutLine', () => {
  it('says what you’re paid after your fee, as you type the price', () => {
    expect(payoutLine('40', { level: 1 })).toBe(
      'You get $35.20 after the 12% fee (level 1 seller).',
    );
    expect(payoutLine('40.50', { level: 3 })).toBe(
      'You get $36.04 after the 11% fee (level 3 seller).',
    );
  });

  it('says nothing for a price that isn’t one yet, or without a standing', () => {
    for (const text of ['', '4.', 'abc', '0.50', '10000.01']) {
      expect(payoutLine(text, { level: 1 })).toBe('');
    }
    expect(payoutLine('40', null)).toBe('');
  });
});

describe('standingText', () => {
  it('says where you are and what the next level needs', () => {
    expect(standingText(standing())).toBe(
      'Level 2 seller · 11.5% fee · 3 sales ($120.00) in the last 90 days. ' +
        'Level 3 (11% fee) needs 7 more sales and $380.00 more in sales.',
    );
  });

  it('names only what’s missing, including reliability', () => {
    const next = {
      level: 4,
      salesNeeded: 0,
      volumeNeeded: '0.00',
      reliabilityNeeded: 0.8,
      fee: '10.5%',
    };
    expect(standingText(standing({ level: 3, fee: '11%', sales90: 1, next }))).toBe(
      'Level 3 seller · 11% fee · 1 sale ($120.00) in the last 90 days. ' +
        'Level 4 (10.5% fee) needs a reliability score of 80%.',
    );
  });

  it('says so at the top', () => {
    expect(standingText(standing({ level: 5, fee: '10%', next: null }))).toMatch(
      /That’s the top level\.$/,
    );
  });
});
