// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { lineLayout } from '../lib/charts.js';
import { levelText, marketIndexSection } from './marketIndex.js';
import { netWorthChart, portfolioSection, portfolioSummary } from './portfolio.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { marketIndex: vi.fn(), portfolio: vi.fn() } };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const mount = (element) => {
  document.body.replaceChildren(element);
  return element;
};

beforeEach(() => vi.clearAllMocks());

describe('the reVINYL 30', () => {
  const index = {
    level: 1042.5,
    change30: 0.042,
    series: [
      { day: '2026-11-18', level: 1000 },
      { day: '2026-11-19', level: 1020 },
      { day: '2026-11-20', level: 1042.5 },
    ],
    members: [
      {
        release: { id: 1, title: 'Never Gonna Give You Up', artist: 'Rick Astley' },
        weight: 0.75,
        price: '18.00',
      },
      { release: { id: 2, title: 'Other' }, weight: 0.25, price: '9.00' },
    ],
    size: 30,
    rebalanceDays: 7,
    rebalancedOn: '2026-11-18',
  };

  it('shows the level, its 30-day change, a line and the biggest members', async () => {
    api.marketIndex.mockResolvedValue({ index });
    const element = mount(marketIndexSection({ signal: new AbortController().signal }));
    await settle();
    expect(element.querySelector('.index-number').textContent).toBe('1,042.50');
    expect(element.querySelector('.index-change').textContent).toBe(' +4% in 30 days');
    expect(element.querySelector('svg').getAttribute('aria-label')).toBe(
      'The reVINYL 30 over 3 days, now 1,042.50.',
    );
    expect(
      [...element.querySelectorAll('tbody tr')].map((tr) => tr.children[2].textContent),
    ).toEqual(['75.0%', '25.0%']);
  });

  it('waits for the first sale', async () => {
    api.marketIndex.mockResolvedValue({
      index: { ...index, level: null, series: [], members: [] },
    });
    const element = mount(marketIndexSection({ signal: new AbortController().signal }));
    await settle();
    expect(element.textContent).toMatch(/starts with the first sale/);
  });

  it('draws the line left to right, higher levels higher', () => {
    const { path, last } = lineLayout(index.series);
    const points = path.split(' ').map((step) => step.slice(1).split(',').map(Number));
    expect(points.map(([x]) => x)).toEqual([...points.map(([x]) => x)].sort((a, b) => a - b));
    expect(points[2][1]).toBeLessThan(points[0][1]);
    expect(last.x).toBeCloseTo(points[2][0], 1);
    expect(last.y).toBeCloseTo(points[2][1], 1);
    expect(levelText(1000)).toBe('1,000.00');
  });
});

describe('net worth over time', () => {
  it('draws from the first day you had anything, and needs two days', () => {
    const history = [
      { day: '2026-11-17', netWorth: '0.00' },
      { day: '2026-11-18', netWorth: '2000.00' },
      { day: '2026-11-19', netWorth: '1990.00' },
      { day: '2026-11-20', netWorth: '2040.00' },
    ];
    const chart = netWorthChart(history);
    expect(chart.getAttribute('aria-label')).toBe('Your net worth over 3 days, now $2040.00.');
    expect(
      chart.querySelectorAll('text')[chart.querySelectorAll('text').length - 2].textContent,
    ).toBe('2026-11-18');
    expect(netWorthChart(history.slice(0, 2))).toBeNull();
    expect(netWorthChart()).toBeNull();
  });
});

describe('your portfolio', () => {
  const totals = {
    cash: '1960.00',
    holdings: '80.00',
    netWorth: '2040.00',
    unrealized: '5.00',
    realized: '12.80',
    invested: '40.00',
    returnShare: 0.445,
    unpriced: 1,
  };

  it('sums it up in a sentence', () => {
    expect(portfolioSummary(totals)).toBe(
      'Net worth $2040.00: $1960.00 cash and $80.00 of records at fair value. ' +
        'On the $40.00 you’ve put into records here, you’re +$5.00 on paper and +$12.80 from sales: up 44.5%. ' +
        '1 record has no fair value yet (never sold here).',
    );
    expect(portfolioSummary({ ...totals, returnShare: null, unpriced: 0 })).toBe(
      'Net worth $2040.00: $1960.00 cash and $80.00 of records at fair value.',
    );
  });

  it('lists holdings with cost and gain, and sales with what they paid', async () => {
    api.portfolio.mockResolvedValue({
      portfolio: {
        totals,
        holdings: [
          {
            release: { id: 1, title: 'A' },
            code: 'VG+',
            status: 'in_crate',
            cost: '40.00',
            fair: '45.00',
            unrealized: '5.00',
          },
          {
            release: { id: 1, title: 'A' },
            code: 'NM',
            status: 'listed',
            cost: null,
            fair: '60.00',
            unrealized: null,
          },
        ],
        realized: [
          {
            release: { id: 1, title: 'A' },
            code: 'VG+',
            proceeds: '52.80',
            cost: '40.00',
            gain: '12.80',
          },
        ],
      },
    });
    const element = mount(portfolioSection({ signal: new AbortController().signal }));
    await settle();
    const rows = [...element.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.children].slice(1).map((td) => td.textContent),
    );
    expect(rows).toEqual([
      ['$40.00', '$45.00', '+$5.00'],
      ['added by you', '$60.00', '—'],
      ['$52.80', '$40.00', '+$12.80'],
    ]);
  });
});
