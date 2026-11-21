// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { appraisalSection } from './appraisal.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { pricing: vi.fn() } };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const fairValue = {
  grades: [5, 6, 7].map((grade) => ({
    grade,
    code: { 5: 'VG', 6: 'VG+', 7: 'NM' }[grade],
    fair: `${grade * 5}.00`,
    low: `${grade * 4}.00`,
    high: `${grade * 6}.00`,
    sales: grade === 6 ? 2 : 0,
  })),
  gradeStep: 0.25,
  salesUsed: 2,
  outliers: 0,
  halfLifeDays: 30,
};

function render() {
  const { element, refresh } = appraisalSection({
    releaseId: 249504,
    signal: new AbortController().signal,
  });
  document.body.replaceChildren(element);
  return { element, refresh };
}

beforeEach(() => vi.clearAllMocks());

describe('the appraisal', () => {
  it('lists every grade best first, with its range, marking the ones that sold', async () => {
    api.pricing.mockResolvedValue({ pricing: { fairValue, odds: {} } });
    const { element } = render();
    await settle();
    const rows = [...element.querySelectorAll('tbody tr')];
    expect(rows.map((tr) => tr.firstChild.textContent)).toEqual(['NM', 'VG+', 'VG']);
    expect([...rows[1].children].map((td) => td.textContent)).toEqual([
      'VG+',
      '$30.00',
      '$24.00 to $36.00',
      '2',
    ]);
    expect(rows[1].className).toBe('appraisal-sold');
    expect(element.querySelector('.statement-books').textContent).toMatch(/adds about 25%/);
  });

  it('says so before the first sale, and when it can’t be read', async () => {
    api.pricing.mockResolvedValueOnce({ pricing: { fairValue: null, odds: {} } });
    const { element, refresh } = render();
    await settle();
    expect(element.textContent).toMatch(/No sales yet/);
    api.pricing.mockRejectedValueOnce(new ApiError(503, 'DOWN', 'down'));
    refresh();
    await settle();
    expect(element.textContent).toMatch(/isn’t available right now/);
  });
});
