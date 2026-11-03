// Edge cases for the order rules. The main rules are tested in
// server/src/market/orderBook.test.js, next to the engine that relies on them.
import { describe, expect, it } from 'vitest';
import { fieldErrors } from './validation.js';
import { formatCents, parseDollars, validateOrder } from './orders.js';

describe('parseDollars', () => {
  it('ignores spaces around the number, as forms often send them', () => {
    expect(parseDollars('  40.50 ')).toBe(4050);
  });

  it('handles zeros and small amounts', () => {
    expect(parseDollars('0')).toBe(0);
    expect(parseDollars('0.05')).toBe(5);
    expect(parseDollars('0.5')).toBe(50);
    expect(parseDollars('007.10')).toBe(710);
  });

  it.each([
    '$40',
    '1,000',
    '1e3',
    '0x10',
    '+40',
    '.50',
    '40.',
    '40.5.0',
    '40 50',
    'Infinity',
    'NaN',
    '٤٠', // Arabic-Indic digits look like numbers but aren't plain ASCII digits
    ' ',
  ])('rejects %j', (text) => {
    expect(parseDollars(text)).toBeNull();
  });

  it.each([[40.5], [40], [null], [undefined], [{}], [['40']]])(
    'rejects %j because it is not a string',
    (value) => {
      expect(parseDollars(value)).toBeNull();
    },
  );

  it('rejects amounts too big to count exactly instead of rounding them', () => {
    expect(parseDollars('90071992547409.91')).toBe(9_007_199_254_740_991);
    expect(parseDollars('90071992547409.92')).toBeNull();
    expect(parseDollars('9'.repeat(400))).toBeNull();
  });
});

describe('formatCents', () => {
  it('always shows two decimals and no thousands separator', () => {
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(99)).toBe('0.99');
    expect(formatCents(1_000_000)).toBe('10000.00');
  });

  it('puts the minus sign in front, including under a dollar', () => {
    expect(formatCents(-5)).toBe('-0.05');
    expect(formatCents(-4050)).toBe('-40.50');
  });

  it.each([[40.5], [NaN], [Infinity], ['4050'], [null], [undefined]])(
    'refuses %j, which is not a whole number of cents',
    (value) => {
      expect(() => formatCents(value)).toThrow(RangeError);
    },
  );

  it('gives back the same cents after a round trip through parseDollars', () => {
    for (const cents of [0, 1, 9, 10, 99, 100, 101, 1999, 4050, 1_000_000]) {
      expect(parseDollars(formatCents(cents))).toBe(cents);
    }
  });
});

describe('validateOrder', () => {
  const problems = (order) => {
    try {
      validateOrder(order);
    } catch (error) {
      return fieldErrors(error);
    }
    return {};
  };

  it('returns only the fields it checked, so stray input can’t slip through', () => {
    const order = { side: 'bid', priceCents: 4000, minGrade: 6, isAdmin: true, grade: 8 };

    expect(validateOrder(order)).toEqual({ side: 'bid', priceCents: 4000, minGrade: 6 });
  });

  it('keeps a valid target', () => {
    const order = { side: 'bid', priceCents: 4000, minGrade: 6, targetOrderId: 12 };

    expect(validateOrder(order).targetOrderId).toBe(12);
  });

  it('accepts the lowest and highest grades', () => {
    expect(problems({ side: 'bid', priceCents: 4000, minGrade: 1 })).toEqual({});
    expect(problems({ side: 'bid', priceCents: 4000, minGrade: 8 })).toEqual({});
    expect(problems({ side: 'ask', priceCents: 4000, grade: 1, copyId: 1 })).toEqual({});
    expect(problems({ side: 'ask', priceCents: 4000, grade: 8, copyId: 1 })).toEqual({});
  });

  it.each([
    ['a text price', { side: 'bid', priceCents: '4000', minGrade: 6 }, 'priceCents'],
    ['NaN', { side: 'bid', priceCents: NaN, minGrade: 6 }, 'priceCents'],
    ['Infinity', { side: 'bid', priceCents: Infinity, minGrade: 6 }, 'priceCents'],
    ['a fractional grade', { side: 'bid', priceCents: 4000, minGrade: 6.5 }, 'minGrade'],
    ['a text grade', { side: 'ask', priceCents: 4000, grade: 'VG+', copyId: 1 }, 'grade'],
    ['a text copy id', { side: 'ask', priceCents: 4000, grade: 6, copyId: '1' }, 'copyId'],
    ['a negative copy id', { side: 'ask', priceCents: 4000, grade: 6, copyId: -1 }, 'copyId'],
    ['no side', { priceCents: 4000, minGrade: 6 }, 'side'],
    [
      'a bad target',
      { side: 'bid', priceCents: 4000, minGrade: 6, targetOrderId: 0 },
      'targetOrderId',
    ],
  ])('rejects %s', (_name, order, field) => {
    expect(problems(order)).toHaveProperty(field);
  });

  it.each([[null], [undefined], ['bid'], [42]])('rejects %j, which is not an order', (value) => {
    expect(() => validateOrder(value)).toThrow();
  });

  it('reports every bad field at once, so a form can show them together', () => {
    const fields = problems({ side: 'ask', priceCents: 1, grade: 99 });

    expect(Object.keys(fields).sort()).toEqual(['copyId', 'grade', 'priceCents']);
  });
});
