import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api.js';

/** Answers every fetch with `body` and records what was asked. */
function stubFetch(status, body) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** The method, URL and JSON body of the nth fetch. */
function sent(fetch, n = 0) {
  const [url, init] = fetch.mock.calls[n];
  return {
    url,
    method: init.method,
    body: init.body === undefined ? undefined : JSON.parse(init.body),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trade requests (Part 5)', () => {
  let fetch;
  beforeEach(() => {
    fetch = stubFetch(200, { ok: true });
  });

  it('buys an ad by its id alone, so the price always comes from the server', async () => {
    await api.buy(12);
    expect(sent(fetch)).toEqual({ url: '/api/orders/12/buy', method: 'POST', body: {} });
  });

  it('sells to a wanted ad with the chosen copy', async () => {
    await api.sellTo(7, 31);
    expect(sent(fetch)).toEqual({
      url: '/api/orders/7/sell',
      method: 'POST',
      body: { copyId: 31 },
    });
  });

  it('lists trades, with or without a status', async () => {
    await api.trades();
    await api.trades({ status: 'shipped' });
    expect(sent(fetch, 0)).toEqual({ url: '/api/trades?', method: 'GET', body: undefined });
    expect(sent(fetch, 1).url).toBe('/api/trades?status=shipped');
  });

  it.each(['ship', 'cancel', 'received', 'refund'])('posts the %s step', async (step) => {
    await api.tradeStep(5, step);
    expect(sent(fetch)).toEqual({ url: `/api/trades/5/${step}`, method: 'POST', body: {} });
  });

  it("turns the server's error into an ApiError the page can show", async () => {
    stubFetch(409, {
      error: { code: 'TARGET_UNAVAILABLE', message: 'Someone else just took that ad.' },
    });
    const error = await api.buy(12).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'TARGET_UNAVAILABLE' });
    expect(error.message).toBe('Someone else just took that ad.');
  });
});
