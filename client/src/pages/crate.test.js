// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api.js';
import { session } from '../session.js';
import { cratePage } from './crate.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    api: {
      wallet: vi.fn(),
      crate: vi.fn(),
      orders: vi.fn(),
      removeCopy: vi.fn(),
      cancelOrder: vi.fn(),
    },
  };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const release = {
  id: 249504,
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  thumbUrl: null,
};
const copy = (id, status, ask = null) => ({
  id,
  releaseId: release.id,
  status,
  ask,
  condition: 'VG+/VG',
  headline: '',
  notes: '',
  flags: ['warp'],
  photos: [],
  release,
});

function page() {
  const element = cratePage({
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
  api.wallet.mockResolvedValue({
    wallet: { cash: '1965.00', held: '40.00', spendable: '1925.00' },
  });
  api.crate.mockResolvedValue({
    copies: [
      copy(1, 'in_crate'),
      copy(2, 'listed', { orderId: 9, price: '42.00' }),
      copy(3, 'in_trade'),
    ],
  });
  api.orders.mockResolvedValue({
    orders: [
      { id: 5, side: 'bid', price: '40.00', minGrade: 7, note: '', releaseId: release.id, release },
    ],
  });
});
afterEach(() => session.set(null));

describe('cratePage', () => {
  it('asks a logged-out visitor to log in', () => {
    session.set(null);
    const element = page();

    expect(element.querySelector('a').getAttribute('href')).toBe('/login?next=%2Fcrate');
    expect(api.wallet).not.toHaveBeenCalled();
  });

  it('shows the money, every copy with its state, and the open wanted ads', async () => {
    const element = page();
    await settle();

    expect([...element.querySelectorAll('.wallet-amount')].map((node) => node.textContent)).toEqual(
      ['$1965.00', '$40.00', '$1925.00'],
    );
    const states = [...element.querySelectorAll('.crate-list')[0].children].map(
      (item) => item.querySelector('.crate-actions .label').textContent,
    );
    expect(states).toEqual(['In your crate', 'For sale at $42.00', 'In a trade: waiting to ship']);
    expect(element.textContent).toContain('Warped');
    expect(element.querySelectorAll('.crate-list')[1].textContent).toContain(
      'NM or better, up to $40.00',
    );
  });

  it('removes a copy only on the second press', async () => {
    api.removeCopy.mockResolvedValue(null);
    const element = page();
    await settle();
    const remove = element.querySelector('.crate-item .crate-actions button');

    remove.click();
    await settle();
    expect(api.removeCopy).not.toHaveBeenCalled();
    expect(remove.textContent).toBe('Press again to remove');

    remove.click();
    await settle();
    expect(api.removeCopy).toHaveBeenCalledWith(1);
    expect(element.querySelector('.coupon-flash').textContent).toBe(
      'Copy removed from your crate.',
    );
  });

  it('cancels a FOR SALE ad from the crate', async () => {
    api.cancelOrder.mockResolvedValue({});
    const element = page();
    await settle();
    const buttons = [...element.querySelectorAll('.crate-actions button')];

    buttons.find((button) => button.textContent === 'Cancel FOR SALE ad').click();
    await settle();

    expect(api.cancelOrder).toHaveBeenCalledWith(9);
  });
});
