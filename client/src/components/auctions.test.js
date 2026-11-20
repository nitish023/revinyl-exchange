// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { auctionsSection, bidCount, resultLine } from './auctions.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: { auctions: vi.fn(), auctionBid: vi.fn(), cancelAuction: vi.fn() },
  };
});

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const auction = (overrides = {}) => ({
  id: 7,
  releaseId: 249504,
  copy: { id: 3, grade: 6, sleeveGrade: 6, headline: 'Plays clean' },
  seller: { name: 'groovegarden' },
  mine: false,
  reserve: '20.00',
  status: 'open',
  endsAt: '2026-11-23T16:00:00.000Z',
  bids: 2,
  myBid: null,
  price: null,
  ...overrides,
});

function render(user = { id: 2 }) {
  const { element, refresh } = auctionsSection({
    releaseId: 249504,
    user: () => user,
    signal: new AbortController().signal,
  });
  document.body.replaceChildren(element);
  return { element, refresh };
}

beforeEach(() => vi.clearAllMocks());

describe('the auctions section', () => {
  it('lists open auctions with sealed bid counts, and recent results', async () => {
    api.auctions.mockResolvedValue({
      auctions: {
        open: [auction()],
        results: [auction({ id: 6, status: 'sold', price: '48.00', bids: 3 })],
      },
    });
    const { element } = render();
    await settle();
    const card = element.querySelector('.auction-card');
    expect(card.textContent).toMatch(/^VG\+\/VG\+ · Plays clean · groovegarden/);
    expect(card.textContent).toMatch(/Reserve \$20\.00 · ends .* · 2 sealed bids/);
    expect(card.querySelector('button').textContent).toBe('Place a sealed bid');
    expect(element.textContent).toMatch(/Sold for \$48\.00 after 3 sealed bids\./);
  });

  it('places a sealed bid and says it’s held; a refused bid says why', async () => {
    api.auctions.mockResolvedValue({ auctions: { open: [auction()], results: [] } });
    api.auctionBid.mockRejectedValueOnce(
      new ApiError(400, 'BELOW_RESERVE', 'x', {
        amount: 'The reserve is $20.00: bid at least that.',
      }),
    );
    const { element } = render();
    await settle();
    const form = element.querySelector('form');
    form.querySelector('input').value = '15';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(form.querySelector('.field-error').textContent).toBe(
      'The reserve is $20.00: bid at least that.',
    );

    api.auctionBid.mockResolvedValueOnce({});
    form.querySelector('input').value = '45';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(api.auctionBid).toHaveBeenLastCalledWith(7, '45');
    expect(element.querySelector('.coupon-flash').textContent).toMatch(/sealed bid of \$45 is in/);
  });

  it('a seller can take down an auction nobody has bid on; a guest is asked to log in', async () => {
    api.auctions.mockResolvedValue({
      auctions: { open: [auction({ mine: true, bids: 0 })], results: [] },
    });
    let { element } = render();
    await settle();
    expect(element.querySelector('.auction-card button').textContent).toBe('Take it down');
    api.auctions.mockResolvedValue({ auctions: { open: [auction()], results: [] } });
    ({ element } = render(null));
    await settle();
    expect(element.querySelector('.auction-card a').textContent).toBe('Log in to bid');
  });
});

describe('words', () => {
  it('counts bids and reads results', () => {
    expect(bidCount(0)).toBe('No bids yet');
    expect(bidCount(1)).toBe('1 sealed bid');
    expect(resultLine(auction({ status: 'unsold', bids: 0 }))).toBe(
      'Ended unsold: no bid met the reserve.',
    );
  });
});
