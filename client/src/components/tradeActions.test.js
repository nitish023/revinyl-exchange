// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { stepsFor, tradeActions } from './tradeActions.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { tradeStep: vi.fn() } };
});

const trade = (role, status) => ({
  id: 14,
  role,
  status,
  price: '31.00',
  release: { id: 249504, title: 'Never Gonna Give You Up' },
});
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const labels = (element) => [...element.querySelectorAll('button')].map((b) => b.textContent);

function render(role, status) {
  const onDone = vi.fn();
  const element = tradeActions({ trade: trade(role, status), onDone });
  if (element) document.body.replaceChildren(element);
  return { element, onDone };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.tradeStep.mockResolvedValue({});
});

describe('which buttons each side gets', () => {
  it('seller ships or cancels while it waits; buyer checks it once shipped', () => {
    expect(labels(render('seller', 'awaiting_shipment').element)).toEqual([
      'Ship it',
      'Cancel sale',
    ]);
    expect(labels(render('buyer', 'shipped').element)).toEqual(['It arrived', 'Not as described']);
  });

  it('shows nothing when it’s the other person’s turn or the trade is settled', () => {
    for (const [role, status] of [
      ['buyer', 'awaiting_shipment'],
      ['seller', 'shipped'],
      ['buyer', 'completed'],
      ['seller', 'completed'],
      ['buyer', 'refunded'],
      ['seller', 'refunded'],
    ]) {
      expect(render(role, status).element).toBeNull();
      expect(stepsFor(trade(role, status))).toEqual([]);
    }
  });
});

describe('pressing them', () => {
  it('ships on the first press: no money moves', async () => {
    const { element, onDone } = render('seller', 'awaiting_shipment');
    element.querySelector('button').click();
    await settle();
    expect(api.tradeStep).toHaveBeenCalledWith(14, 'ship');
    expect(onDone).toHaveBeenCalledWith('Marked as shipped. The buyer will check it.');
  });

  it.each([
    ['seller', 'awaiting_shipment', 1, 'cancel', 'Refund the buyer?'],
    ['buyer', 'shipped', 0, 'received', 'Pay the seller $31.00?'],
    ['buyer', 'shipped', 1, 'refund', 'Send it back for a refund?'],
  ])('%s %s: %s takes a second press (%s)', async (role, status, index, step, confirm) => {
    const { element, onDone } = render(role, status);
    const button = element.querySelectorAll('button')[index];
    button.click();
    await settle();
    expect(api.tradeStep).not.toHaveBeenCalled();
    expect(button.textContent).toBe(confirm);

    button.click();
    await settle();
    expect(api.tradeStep).toHaveBeenCalledWith(14, step);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('passes on the server’s message when the other person acted first (409)', async () => {
    api.tradeStep.mockRejectedValue(
      new ApiError(409, 'TRADE_NOT_IN_THAT_STATE', 'It has already been refunded.'),
    );
    const { element, onDone } = render('seller', 'awaiting_shipment');
    element.querySelector('button').click();
    await settle();
    expect(onDone).toHaveBeenCalledWith('It has already been refunded.');
  });
});
