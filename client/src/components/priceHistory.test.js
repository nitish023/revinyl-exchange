// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { priceHistorySection } from './priceHistory.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { history: vi.fn() } };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const history = {
  candles: [
    { day: '2026-11-01', open: '40.00', high: '45.00', low: '38.00', close: '44.00', sales: 2 },
    { day: '2026-11-05', open: '44.00', high: '44.00', low: '30.00', close: '31.00', sales: 4 },
  ],
  stats: {
    lastClose: '31.00',
    change30: null,
    monthlyVolatility: null,
    low52: '30.00',
    high52: '45.00',
  },
  depth: [
    {
      grade: 6,
      code: 'VG+',
      bids: [{ price: '25.00', copies: 1 }],
      asks: [{ price: '40.00', copies: 2 }],
      spread: { bid: '25.00', ask: '40.00', amount: '15.00', share: 0.375 },
    },
    {
      grade: 7,
      code: 'NM',
      bids: [{ price: '25.00', copies: 1 }],
      asks: [],
      spread: null,
    },
  ],
};

function render() {
  const { element } = priceHistorySection({ releaseId: 1, signal: new AbortController().signal });
  document.body.replaceChildren(element);
  return element;
}

beforeEach(() => vi.clearAllMocks());

describe('the price history', () => {
  it('draws a candle per day and the book, each with a description for screen readers', async () => {
    api.history.mockResolvedValue({ history });
    const element = render();
    await settle();
    const charts = element.querySelectorAll('svg[role="img"]');
    expect(charts).toHaveLength(2);
    expect(element.querySelectorAll('.candle')).toHaveLength(2);
    expect(element.querySelectorAll('.candle-down')).toHaveLength(1);
    expect(charts[0].getAttribute('aria-label')).toMatch(
      /^Daily prices in VG\+ terms\. Last sale \$31\.00/,
    );
    // The busiest grade's book first.
    expect(charts[1].getAttribute('aria-label')).toBe(
      'The book for a VG+ copy: 1 copy wanted, 2 for sale. Spread $15.00 (38% of the cheapest copy).',
    );
    expect(element.textContent).toMatch(/a spread of \$15\.00/);
  });

  it('shows the book for another grade on request, and keeps it through a refresh', async () => {
    api.history.mockResolvedValue({ history });
    const { element, refresh } = priceHistorySection({
      releaseId: 1,
      signal: new AbortController().signal,
    });
    document.body.replaceChildren(element);
    await settle();
    const nm = [...element.querySelectorAll('.book-grades button')].find(
      (button) => button.textContent === 'NM',
    );
    nm.click();
    const sentence = () => element.querySelector('.book-panel .statement-books').textContent;
    expect(sentence()).toBe(
      '0 NM copies for sale; 1 wanted ad takes that grade. One side is empty, so there’s no spread.',
    );
    refresh();
    await settle();
    expect(sentence()).toMatch(/^0 NM copies/);
    expect(element.querySelector('[aria-pressed="true"]').textContent).toBe('NM');
  });

  it('says so before the first sale and with an empty book', async () => {
    api.history.mockResolvedValue({ history: { candles: [], stats: {}, depth: [] } });
    const element = render();
    await settle();
    expect(element.querySelectorAll('svg')).toHaveLength(0);
    expect(element.textContent).toMatch(/No sales yet/);
    expect(element.textContent).toMatch(/No open ads/);
  });
});
