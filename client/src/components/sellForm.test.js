// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { sellForm } from './adForms.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { placeOrder: vi.fn() } };
});

const pricing = {
  fairValue: {
    grades: [
      { grade: 6, code: 'VG+', fair: '40.00', low: '32.00', high: '50.00', sales: 3 },
      { grade: 7, code: 'NM', fair: '52.00', low: '41.00', high: '66.00', sales: 0 },
    ],
  },
  odds: { alpha: Math.log(1 / 10), beta: -4 },
};
const copies = [
  { id: 1, grade: 6, condition: 'VG+/VG+', headline: '' },
  { id: 2, grade: 7, condition: 'NM/NM', headline: '' },
];
const texts = (element) =>
  [...element.querySelectorAll('.payout-preview')].map((p) => p.textContent).filter(Boolean);

function render(options = {}) {
  const element = sellForm({
    copies,
    standing: { level: 1 },
    pricing,
    onDone: vi.fn(),
    ...options,
  });
  document.body.replaceChildren(element);
  return element;
}

describe('the sell form’s price help (Parts 12 and 13)', () => {
  it('appraises the copy you pick and offers three prices', () => {
    const element = render();
    expect(texts(element)).toEqual([]); // no copy chosen yet
    const select = element.querySelector('select');
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(texts(element)).toEqual(['Fair value for NM: $52.00 (likely $41.00 to $66.00).']);
    expect(element.querySelectorAll('.price-chip')).toHaveLength(3);
  });

  it('a suggested price fills the price in, with its chance of selling and your payout', () => {
    const element = render({ copies: [copies[0]] }); // one copy: chosen already
    const fairChip = [...element.querySelectorAll('.price-chip')].find((chip) =>
      chip.textContent.startsWith('Fair value'),
    );
    fairChip.click();
    expect(element.querySelector('input[inputmode=decimal]').value).toBe('40.00');
    expect(texts(element)).toEqual([
      'Fair value for VG+: $40.00 (likely $32.00 to $50.00).',
      'At $40.00: a 50% chance it sells within a week, 95% within a month.',
      'You get $35.20 after the 12% fee (level 1 seller).',
    ]);
  });

  it('still works with no appraisal (a pressing that never sold)', () => {
    const element = render({ copies: [copies[0]], pricing: null });
    expect(element.querySelectorAll('.price-chip')).toHaveLength(0);
    const price = element.querySelector('input[inputmode=decimal]');
    price.value = '40';
    price.dispatchEvent(new Event('input'));
    expect(texts(element)).toEqual(['You get $35.20 after the 12% fee (level 1 seller).']);
  });
});
