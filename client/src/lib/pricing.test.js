import { describe, expect, it } from 'vitest';
import { appraisalNote, chanceLine, fairFor, fairLine, suggestionChips } from './pricing.js';

const grades = [6, 7].map((grade) => ({
  grade,
  code: grade === 6 ? 'VG+' : 'NM',
  fair: grade === 6 ? '40.00' : '52.00',
  low: grade === 6 ? '32.00' : '41.00',
  high: grade === 6 ? '50.00' : '66.00',
  sales: grade === 6 ? 3 : 0,
}));
const pricing = {
  fairValue: { grades, gradeStep: 0.3, salesUsed: 3, outliers: 1, halfLifeDays: 30 },
  odds: { alpha: Math.log(1 / 10), beta: -4 },
};

describe('the sell form’s price help', () => {
  it('finds the fair value for the copy’s grade', () => {
    const row = fairFor(pricing, 6);
    expect(row.fairCents).toBe(4000);
    expect(fairLine(row)).toBe('Fair value for VG+: $40.00 (likely $32.00 to $50.00).');
    expect(fairFor(pricing, 3)).toBeNull();
    expect(fairFor(null, 6)).toBeNull();
  });

  it('says how likely a typed price is to sell', () => {
    const row = fairFor(pricing, 6);
    expect(chanceLine('40', pricing, row)).toBe(
      'At $40.00: a 50% chance it sells within a week, 95% within a month.',
    );
    expect(chanceLine('4.', pricing, row)).toBe('');
    expect(chanceLine('40', pricing, null)).toBe('');
  });

  it('offers a quick, a fair and a patient price', () => {
    const chips = suggestionChips(pricing, fairFor(pricing, 6));
    expect(chips.map((chip) => chip.label.split(' $')[0])).toEqual([
      'Quick sale',
      'Fair value',
      'Patient',
    ]);
    expect(chips[1]).toEqual({ label: 'Fair value $40.00 · 50% within a week', price: '40.00' });
    expect(Number(chips[0].price)).toBeLessThan(40);
    expect(suggestionChips(pricing, null)).toEqual([]);
  });
});

it('explains the appraisal in a sentence', () => {
  expect(appraisalNote(pricing.fairValue)).toBe(
    'Each grade up adds about 30%. From 3 sales, recent ones counting most (a sale’s weight ' +
      'halves every 30 days). 1 unusual sale was set aside. Eight in ten sales should land in the range.',
  );
});
