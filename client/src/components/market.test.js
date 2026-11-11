import { describe, expect, it, vi } from 'vitest';

// Part 5 fills adActions in; here a stand-in shows what the market hands it.
vi.mock('./adActions.js', () => ({
  adActions: vi.fn(({ ad, kind, mine }) => {
    const button = document.createElement('button');
    button.textContent = `${kind}:${ad.orderId}:${mine}`;
    return button;
  }),
}));
import { marketSection } from './market.js';

const release = { id: 249504, title: 'Never Gonna Give You Up', artist: 'Rick Astley' };

const forSaleAd = (orderId, grade, price, extra = {}) => ({
  orderId,
  price,
  listedAt: '2026-11-01T12:00:00Z',
  copy: {
    id: orderId + 100,
    grade,
    sleeveGrade: grade,
    condition: grade === 7 ? 'NM/NM' : 'VG+/VG+',
    flags: [],
    headline: '',
    notes: '',
    photos: 0,
  },
  seller: { name: 'groovegarden', trades: 4 },
  ...extra,
});

function market({ forSale, wanted = [], byGrade = [], recentSales = [] } = {}) {
  return {
    releaseId: release.id,
    asOf: '2026-11-08T12:00:00Z',
    forSale: forSale ?? [
      { grade: 7, ads: [forSaleAd(1, 7, '30.00')] },
      { grade: 6, ads: [forSaleAd(2, 6, '22.00'), forSaleAd(3, 6, '24.00')] },
    ],
    wanted,
    report: {
      highestBid: wanted[0] ? { price: wanted[0].price, minGrade: wanted[0].minGrade } : null,
      lowestAsk: { price: '22.00', grade: 6 },
      lastSale: recentSales[0] ?? null,
      byGrade,
      recentSales,
    },
  };
}

const section = () => marketSection({ release, user: () => null, onPosted: () => {} });
const text = (element) => element.textContent.replace(/\s+/g, ' ');

describe('the classifieds', () => {
  it('shows a section per grade with the ads in the order the server sent', () => {
    const view = section();
    view.show(market());
    const headings = [...view.classifieds.querySelectorAll('.ad-section h3')].map(text);
    expect(headings).toEqual(['NM NEAR MINT', 'VG+ VERY GOOD PLUS']);
    const prices = [...view.classifieds.querySelectorAll('.ad-price')].map(text);
    expect(prices).toEqual(['$30.00', '$22.00', '$24.00']);
    expect(text(view.classifieds)).toContain('3 copies for sale · 0 wanted ads');
  });

  it('lists WANTED ads last, signed without the buyer’s name', () => {
    const view = section();
    const wanted = [
      {
        orderId: 9,
        price: '28.00',
        minGrade: 7,
        note: 'For a listening room',
        postedAt: '',
        buyer: { trades: 9 },
      },
    ];
    view.show(market({ wanted }));
    const last = [...view.classifieds.querySelectorAll('.ad')].at(-1);
    expect(text(last)).toContain('NM OR BETTER. For a listening room Buyer, 9 trades.');
    expect(text(last)).toContain('Up to $28.00');
  });

  it('marks my own ads', () => {
    const view = section();
    view.show(market(), new Set([2]));
    const mine = view.classifieds.querySelectorAll('.ad--mine');
    expect(mine).toHaveLength(1);
    expect(mine[0].dataset.orderId).toBe('2');
    expect(text(mine[0])).toContain('Your ad');
  });

  it('marks ads that are new since the last update, but not on the first draw', () => {
    const view = section();
    view.show(market());
    expect(view.classifieds.querySelectorAll('.is-new')).toHaveLength(0);
    const next = market();
    next.forSale[1].ads.push(forSaleAd(4, 6, '25.00'));
    view.show(next);
    const fresh = view.classifieds.querySelectorAll('.is-new');
    expect([...fresh].map((ad) => ad.dataset.orderId)).toEqual(['4']);
  });

  it('says when nothing is for sale', () => {
    const view = section();
    view.show(market({ forSale: [] }));
    expect(text(view.classifieds)).toContain('No copies on the shelf yet');
  });

  it('shows the connection status', () => {
    const view = section();
    view.setStatus('reconnecting');
    expect(text(view.classifieds)).toContain('Reconnecting');
    view.setStatus('live');
    expect(view.classifieds.querySelector('.live-status').dataset.status).toBe('live');
  });
});

describe('the Market Report', () => {
  it('is hidden until there is a market to report', () => {
    const view = section();
    expect(view.report.hidden).toBe(true);
    view.show(market());
    expect(view.report.hidden).toBe(false);
  });

  it('shows each grade’s last sale, the change and the range, and recent sales', () => {
    const view = section();
    view.show(
      market({
        byGrade: [
          { grade: 6, last: '42.00', change: '3.00', low: '37.00', high: '44.00', sales: 3 },
        ],
        recentSales: [{ grade: 6, price: '42.00', soldAt: '2026-11-01T15:00:00Z' }],
      }),
    );
    const report = text(view.report);
    expect(report).toContain('Very Good Plus');
    expect(report).toContain('$42');
    expect(report).toContain('▲ $3');
    expect(report).toContain('range $37 to $44');
    expect(text(view.report.querySelector('tbody tr'))).toBe('Nov 01VG+$42.00');
    expect(report).toContain('Cheapest copy$22.00, VG+');
  });

  it('says when nothing sold this month', () => {
    const view = section();
    view.show(market());
    expect(text(view.report)).toContain('No sales on reVINYL in the past 30 days.');
    expect(text(view.report)).toContain('Nothing has sold yet.');
  });
});

describe('ad buttons (Part 5 hook)', () => {
  it('asks adActions for buttons on every ad that isn’t mine, and shows them by the price', () => {
    const view = section();
    const wanted = [
      { orderId: 9, price: '28.00', minGrade: 7, note: '', postedAt: '', buyer: { trades: 1 } },
    ];
    view.show(market({ wanted }), new Set([2]));
    const buttons = [...view.classifieds.querySelectorAll('.ad-foot button')].map(text);
    expect(buttons).toEqual(['forSale:1:false', 'forSale:3:false', 'wanted:9:false']);
    expect(text(view.classifieds.querySelector('[data-order-id="2"] .ad-foot'))).toContain(
      'Your ad',
    );
  });
});
