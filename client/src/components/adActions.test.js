// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { adActions, copiesThatFit, copyChoiceLabel } from './adActions.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { buy: vi.fn(), sellTo: vi.fn(), crate: vi.fn() } };
});

const release = { id: 249504, title: 'Never Gonna Give You Up', artist: 'Rick Astley' };
const user = { id: 1, displayName: 'alice' };
const forSale = { orderId: 5, price: '42.00', copy: { id: 9, grade: 6 } };
const wanted = { orderId: 8, price: '30.00', minGrade: 6, note: '', buyer: { trades: 2 } };
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const copy = (id, grade, status = 'in_crate', ask = null) => ({
  id,
  grade,
  status,
  ask,
  condition: grade === 7 ? 'NM/NM' : grade === 6 ? 'VG+/VG+' : 'VG/VG',
});

function render(options) {
  const onDone = vi.fn();
  const element = adActions({ release, user, mine: false, onDone, ...options });
  if (element) document.body.replaceChildren(element);
  return { element, onDone };
}

const buttonText = (element) => element.querySelector('button').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('adActions', () => {
  it('shows nothing on your own ads', () => {
    expect(render({ ad: forSale, kind: 'forSale', mine: true }).element).toBeNull();
    expect(render({ ad: wanted, kind: 'wanted', mine: true }).element).toBeNull();
  });

  it('asks a logged-out visitor to log in, coming back to this pressing', () => {
    const buy = render({ ad: forSale, kind: 'forSale', user: null }).element;
    expect(buy.textContent).toBe('Log in to buy');
    expect(buy.getAttribute('href')).toBe('/login?next=%2Frelease%2F249504');
    expect(render({ ad: wanted, kind: 'wanted', user: null }).element.textContent).toBe(
      'Log in to sell',
    );
  });

  it('buys only on the second press, which names the price', async () => {
    api.buy.mockResolvedValue({});
    const { element, onDone } = render({ ad: forSale, kind: 'forSale' });
    const button = element.querySelector('button');
    expect(button.textContent).toBe('Buy this copy');

    button.click();
    await settle();
    expect(api.buy).not.toHaveBeenCalled();
    expect(button.textContent).toBe('Pay $42.00?');

    button.click();
    await settle();
    expect(api.buy).toHaveBeenCalledWith(5);
    expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/^Bought for \$42\.00/));
  });

  it('reports a lost race (409) so the market redraws', async () => {
    api.buy.mockRejectedValue(
      new ApiError(409, 'TARGET_UNAVAILABLE', 'Someone else just took that ad.'),
    );
    const { element, onDone } = render({ ad: forSale, kind: 'forSale' });
    element.querySelector('button').click();
    element.querySelector('button').click();
    await settle();
    expect(onDone).toHaveBeenCalledWith('Someone else just took that ad.');
  });

  it('shows a refused buy next to the button and lets you try again', async () => {
    api.buy.mockRejectedValue(
      new ApiError(400, 'INSUFFICIENT_FUNDS', 'You don’t have enough spendable cash.'),
    );
    const { element, onDone } = render({ ad: forSale, kind: 'forSale' });
    element.querySelector('button').click();
    element.querySelector('button').click();
    await settle();
    expect(onDone).not.toHaveBeenCalled();
    expect(element.querySelector('.field-error').textContent).toBe(
      'You don’t have enough spendable cash.',
    );
    expect(element.querySelector('button').disabled).toBe(false);
  });

  it('sells to a wanted ad: picks from the copies that fit, then confirms', async () => {
    api.crate.mockResolvedValue({
      copies: [copy(1, 5), copy(2, 7, 'listed', { orderId: 3, price: '50.00' }), copy(4, 6)],
    });
    api.sellTo.mockResolvedValue({});
    const { element, onDone } = render({ ad: wanted, kind: 'wanted' });
    expect(buttonText(element)).toBe('Sell to them');

    element.querySelector('button').click();
    await settle();
    expect(api.crate).toHaveBeenCalledWith(release.id);
    const options = [...element.querySelectorAll('option')].map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['2', 'NM/NM (listed at $50.00)'],
      ['4', 'VG+/VG+'],
    ]);

    element.querySelector('select').value = '4';
    const sell = element.querySelector('button');
    expect(sell.textContent).toBe('Sell for $30.00');
    sell.click();
    expect(sell.textContent).toBe('Sell it for $30.00?');
    sell.click();
    await settle();
    expect(api.sellTo).toHaveBeenCalledWith(8, 4);
    expect(onDone).toHaveBeenCalledWith(expect.stringMatching(/^Sold for \$30\.00/));
  });

  it('says so when none of your copies is good enough', async () => {
    api.crate.mockResolvedValue({ copies: [copy(1, 5)] });
    const { element } = render({ ad: wanted, kind: 'wanted' });
    element.querySelector('button').click();
    await settle();
    expect(element.textContent).toBe('You have no copy of this pressing at VG+ or better.');
    expect(element.querySelector('select')).toBeNull();
  });

  it('keeps Sell to them when the crate can’t be read', async () => {
    api.crate.mockRejectedValue(
      new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.'),
    );
    const { element } = render({ ad: wanted, kind: 'wanted' });
    element.querySelector('button').click();
    await settle();
    expect(element.querySelector('.field-error').textContent).toMatch(/Could not reach/);
    expect(element.querySelector('button').disabled).toBe(false);
  });
});

describe('copies that fit a wanted ad', () => {
  it('keeps copies in the crate or listed, at the lowest grade or better', () => {
    const copies = [
      copy(1, 6),
      copy(2, 7, 'listed'),
      copy(3, 7, 'in_trade'),
      copy(4, 5),
      copy(5, 8),
    ];
    expect(copiesThatFit(copies, 6).map((c) => c.id)).toEqual([1, 2, 5]);
    expect(copiesThatFit(copies, 9)).toEqual([]);
  });

  it('labels a listed copy with its price', () => {
    expect(copyChoiceLabel(copy(1, 6))).toBe('VG+/VG+');
    expect(copyChoiceLabel(copy(2, 7, 'listed', { orderId: 3, price: '50.00' }))).toBe(
      'NM/NM (listed at $50.00)',
    );
  });
});
