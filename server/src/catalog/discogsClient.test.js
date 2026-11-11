import { describe, expect, it, vi } from 'vitest';
import releaseFixture from './fixtures/release-249504.json' with { type: 'json' };
import collectionFixture from './fixtures/collection-page.json' with { type: 'json' };
import fieldsFixture from './fixtures/collection-fields.json' with { type: 'json' };
import searchFixture from './fixtures/search-astley.json' with { type: 'json' };
import { DiscogsClient, DiscogsUnavailableError } from './discogsClient.js';
import { RateWindow } from './rateWindow.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(fetchImpl, options = {}) {
  return new DiscogsClient({
    token: options.token ?? 'secret-token',
    userAgent: 'reVINYL-tests',
    limiter: new RateWindow({ limit: 100, windowMs: 60_000, maxWaitMs: 1_000 }),
    fetch: fetchImpl,
    ...(options.now ? { now: options.now } : {}),
  });
}

describe('DiscogsClient', () => {
  it('searches vinyl releases with our token and User-Agent', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchFixture));
    const results = await client(fetchMock).searchVinyl('rick astley', 2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.pathname).toBe('/database/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'rick astley',
      type: 'release',
      format: 'Vinyl',
      page: '2',
    });
    expect(init.headers).toMatchObject({
      'User-Agent': 'reVINYL-tests',
      Authorization: 'Discogs token=secret-token',
    });
    expect(results.results[0]?.id).toBe(249504);
  });

  it('passes the format and year filters to Discogs', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchFixture));
    const results = await client(fetchMock).searchVinyl('rick astley', 1, {
      format: '7in',
      year: 1987,
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url.searchParams.get('format')).toBe('7"');
    expect(url.searchParams.get('year')).toBe('1987');
    expect(results.filters).toEqual({ format: '7in', year: 1987 });
  });

  it('refuses to search without a token, without calling Discogs', async () => {
    const fetchMock = vi.fn();
    const noToken = new DiscogsClient({
      userAgent: 'reVINYL-tests',
      limiter: new RateWindow({ limit: 1, windowMs: 1, maxWaitMs: 1 }),
      fetch: fetchMock,
    });
    await expect(noToken.searchVinyl('abba', 1)).rejects.toMatchObject({
      reason: 'not_configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a release, and returns null for a 404', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(releaseFixture))
      .mockResolvedValueOnce(jsonResponse({ message: 'Release not found.' }, 404));
    const discogs = client(fetchMock);
    expect((await discogs.getRelease(249504))?.title).toBe('Never Gonna Give You Up');
    expect(await discogs.getRelease(1)).toBeNull();
  });

  it('pauses for a minute after Discogs says 429', async () => {
    let now = 0;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'Too many requests' }, 429))
      .mockResolvedValue(jsonResponse(releaseFixture));
    const discogs = client(fetchMock, { now: () => now });

    await expect(discogs.getRelease(249504)).rejects.toMatchObject({ reason: 'busy' });
    now = 30_000;
    await expect(discogs.getRelease(249504)).rejects.toMatchObject({ reason: 'busy' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the paused call never reached Discogs
    now = 61_000;
    await expect(discogs.getRelease(249504)).resolves.toMatchObject({ id: 249504 });
  });

  it('reports network failures and server errors as unavailable', async () => {
    const offline = client(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(offline.getRelease(249504)).rejects.toBeInstanceOf(DiscogsUnavailableError);
    const broken = client(vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    await expect(broken.getRelease(249504)).rejects.toMatchObject({ reason: 'down' });
  });
});

describe('DiscogsClient collections', () => {
  const fields = { media: 1, sleeve: 2 };

  it('reads one page of folder 0, newest first, 100 at a time', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(collectionFixture));
    const page = await client(fetchMock).getCollectionPage('digger', 2, fields);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe('/users/digger/collection/folders/0/releases');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      per_page: '100',
      sort: 'added',
      sort_order: 'desc',
    });
    expect(page.items).toHaveLength(5);
  });

  it('finds the condition fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fieldsFixture));
    expect(await client(fetchMock).getConditionFields('digger')).toEqual({ media: 1, sleeve: 2 });
  });

  it('returns null for a user Discogs doesn’t have, and says when a collection is private', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'User does not exist.' }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: 'You must authenticate.' }, 401))
      .mockResolvedValueOnce(jsonResponse({ message: 'Forbidden.' }, 403));
    const discogs = client(fetchMock);
    expect(await discogs.getConditionFields('nobody')).toBeNull();
    for (let i = 0; i < 2; i += 1) {
      await expect(discogs.getCollectionPage('shy', 1, fields)).rejects.toMatchObject({
        reason: 'private',
      });
    }
  });

  it('keeps a username in its own path segment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fieldsFixture));
    await client(fetchMock).getConditionFields('a/../b');
    expect(new URL(fetchMock.mock.calls[0][0]).pathname).toBe(
      '/users/a%2F..%2Fb/collection/fields',
    );
  });
});
