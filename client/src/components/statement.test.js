// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api.js';
import { booksSentence, signedAmount, statementSection } from './statement.js';

vi.mock('../lib/api.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, api: { statement: vi.fn(), books: vi.fn() } };
});

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const line = (journalId, amount, balance, extra = {}) => ({
  journalId,
  kind: 'trade_payment',
  description: `Line ${journalId}`,
  amount,
  balance,
  tradeId: null,
  releaseId: null,
  at: '2026-11-20T12:00:00.000Z',
  ...extra,
});
const books = { issued: '4000.00', inWallets: '3960.00', inEscrow: '40.00', fees: '0.00' };
const rows = (element) =>
  [...element.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].slice(1).map((td) => td.textContent),
  );

function render() {
  const element = statementSection({ signal: new AbortController().signal });
  document.body.replaceChildren(element);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.books.mockResolvedValue({ books });
});

describe('the statement', () => {
  it('lists each line with a signed amount and the balance after it, and the house books', async () => {
    api.statement.mockResolvedValue({
      lines: [
        line(3, '-40.00', '1960.00', {
          description: 'Paid for Never Gonna Give You Up',
          releaseId: 249504,
        }),
        line(1, '2000.00', '2000.00', { description: 'Starting play money' }),
      ],
      more: false,
    });
    const element = render();
    await settle();
    expect(api.statement).toHaveBeenCalledWith(undefined, expect.any(AbortSignal));
    expect(rows(element)).toEqual([
      ['Paid for Never Gonna Give You Up', '−$40.00', '$1960.00'],
      ['Starting play money', '+$2000.00', '$2000.00'],
    ]);
    expect(element.querySelector('tbody a').getAttribute('href')).toBe('/release/249504');
    expect(element.querySelector('button').hidden).toBe(true);
    expect(element.querySelector('.statement-books').textContent).toBe(booksSentence(books));
  });

  it('pages back from the oldest line shown when there are more', async () => {
    api.statement
      .mockResolvedValueOnce({
        lines: [line(9, '5.00', '2005.00'), line(8, '-5.00', '2000.00')],
        more: true,
      })
      .mockResolvedValueOnce({ lines: [line(1, '2000.00', '2005.00')], more: false });
    const element = render();
    await settle();
    const button = element.querySelector('button');
    expect(button.hidden).toBe(false);
    button.click();
    await settle();
    expect(api.statement).toHaveBeenLastCalledWith(8, expect.any(AbortSignal));
    expect(rows(element)).toHaveLength(3);
    expect(button.hidden).toBe(true);
  });

  it('says so when it can’t be read, and still shows the books', async () => {
    api.statement.mockRejectedValue(new ApiError(503, 'DOWN', 'The ledger is closed for lunch.'));
    const element = render();
    await settle();
    expect(element.querySelector('[role="status"]').textContent).toBe(
      'The ledger is closed for lunch.',
    );
    expect(element.querySelector('.statement-books').textContent).toMatch(/^reVINYL’s books/);
  });
});

it('writes amounts with a sign, using a real minus', () => {
  expect(signedAmount('40.00')).toBe('+$40.00');
  expect(signedAmount('-0.50')).toBe('−$0.50');
});
