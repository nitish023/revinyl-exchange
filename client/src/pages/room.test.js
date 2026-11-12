import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { session } from '../session.js';
import { roomPage } from './room.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { room: vi.fn(), removeCopy: vi.fn(), cancelOrder: vi.fn() } };
});
// The page listens for private live messages; no real WebSocket in tests.
vi.mock('../lib/live.js', () => ({ live: { onPrivate: vi.fn(() => () => {}) } }));
// Part 5 fills tradeActions in; here a stand-in shows what the ledger hands it.
vi.mock('../components/tradeActions.js', () => ({
  tradeActions: vi.fn(({ trade }) => {
    const button = document.createElement('button');
    button.textContent = `act:${trade.id}`;
    return button;
  }),
}));

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();

const release = {
  id: 249504,
  title: 'Night Ferry',
  artist: 'The Lanterns',
  year: 1979,
  thumbUrl: null,
};
const copy = (copyId, overrides = {}) => ({
  kind: 'copy',
  copyId,
  release,
  grade: 6,
  condition: 'VG+/VG',
  status: 'in_crate',
  imported: false,
  photos: 0,
  ask: null,
  tradeId: null,
  tradeStatus: null,
  ...overrides,
});

function sampleRoom() {
  return {
    user: { displayName: 'alice', memberSince: '2026-09-14T12:00:00Z' },
    wallet: { cash: '1537.00', held: '40.00', spendable: '1497.00' },
    shelf: [
      {
        kind: 'incoming',
        release,
        grade: 7,
        condition: 'NM/NM',
        tradeId: 3,
        tradeStatus: 'shipped',
        price: '64.00',
      },
      copy(1),
      copy(2, { status: 'listed', ask: { orderId: 9, price: '44.00' } }),
    ],
    wanted: [
      {
        orderId: 5,
        release,
        price: '40.00',
        minGrade: 6,
        note: '',
        cheapest: null,
        otherBuyers: 0,
      },
    ],
    ledger: [
      {
        id: 3,
        role: 'buyer',
        status: 'shipped',
        grade: 7,
        price: '64.00',
        createdAt: '2026-11-02T12:00:00Z',
        release,
      },
    ],
    counter: { orderId: 11, release, price: '38.00', minGrade: 6, myGrade: 6 },
    value: { total: '38.00', copies: 2 },
  };
}

function page() {
  const element = roomPage({
    params: {},
    query: new URLSearchParams(),
    signal: new AbortController().signal,
    navigate: vi.fn(),
  });
  document.body.replaceChildren(element);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  session.set({ id: 1, displayName: 'alice' });
  api.room.mockResolvedValue({ room: sampleRoom() });
});
afterEach(() => session.set(null));

describe('roomPage', () => {
  it('asks a logged-out visitor to log in', () => {
    session.set(null);
    const element = page();
    expect(element.querySelector('a').getAttribute('href')).toBe('/login?next=%2Froom');
    expect(api.room).not.toHaveBeenCalled();
  });

  it('prints the edition: headline, lead with the money in bold, and the counter tip', async () => {
    const element = page();
    await settle();
    expect(text(element.querySelector('h1'))).toBe('Two Records on the Shelf, One More on the Way');
    expect([...element.querySelectorAll('.room-lead b')].map(text)).toEqual([
      '$1497.00',
      '$40.00',
      '$38',
    ]);
    expect(text(element.querySelector('.room-counter'))).toContain('at $38.00, VG+ or better');
  });

  it('shows the shelf with each record’s state, and links to the import', async () => {
    const element = page();
    await settle();
    expect([...element.querySelectorAll('.shelf-item .record-status')].map(text)).toEqual([
      'On its way to you',
      'In your crate',
      'Listed at $44.00',
    ]);
    expect(element.querySelector('a[href="/room/import"]')).not.toBeNull();
  });

  it('lists wanted ads and the ledger, with Part 5’s buttons on each trade', async () => {
    const element = page();
    await settle();
    expect(text(element.querySelector('.room-ad'))).toContain(
      'WANTED. Night Ferry, 1979, VG+ or better. Up to $40.00.',
    );
    const cells = [...element.querySelectorAll('.ledger-table tbody tr td')].map(text);
    expect(cells).toEqual(['Nov 02', 'Night Ferrybought', 'NM', '−$64.00', 'Shippedact:3']);
  });

  it('removes a copy on the second press, then reloads', async () => {
    api.removeCopy.mockResolvedValue(null);
    const element = page();
    await settle();
    const remove = [...element.querySelectorAll('.shelf-item button')].find(
      (button) => button.textContent === 'Remove',
    );
    remove.click();
    await settle();
    expect(api.removeCopy).not.toHaveBeenCalled();
    remove.click();
    await settle();
    expect(api.removeCopy).toHaveBeenCalledWith(1);
    expect(api.room).toHaveBeenCalledTimes(2);
    expect(text(element.querySelector('.coupon-flash'))).toBe('Copy removed from your shelf.');
  });

  it('cancels a FOR SALE ad and a wanted ad', async () => {
    api.cancelOrder.mockResolvedValue({});
    const element = page();
    await settle();
    [...element.querySelectorAll('.shelf-item button')]
      .find((button) => button.textContent === 'Cancel ad')
      .click();
    await settle();
    expect(api.cancelOrder).toHaveBeenCalledWith(9);
    element.querySelector('.room-ad button').click();
    await settle();
    expect(api.cancelOrder).toHaveBeenCalledWith(5);
  });
});
