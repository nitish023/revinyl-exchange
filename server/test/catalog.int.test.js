import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { CatalogService } from '../src/catalog/catalogService.js';
import { DiscogsUnavailableError } from '../src/catalog/discogsClient.js';
import {
  CATALOG_MAX_AGE_MS,
  createTestContext,
  FakeCatalogSource,
  resetDatabase,
} from './helpers.js';

const ctx = createTestContext();
const app = createApp(ctx, { rateLimit: false });

beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.catalogSource.releaseCalls = 0;
  ctx.catalogSource.searchCalls = 0;
  ctx.catalogSource.failWith = null;
});

afterAll(async () => {
  await ctx.pool.end();
});

describe('GET /api/catalog/search', () => {
  it('returns vinyl results for anyone, no login needed', async () => {
    const response = await request(app).get('/api/catalog/search?q=rick+astley').expect(200);
    expect(response.body).toMatchObject({ query: 'rick astley', page: 1, pages: 3, total: 61 });
    expect(response.body.results[0]).toMatchObject({ id: 249504, artist: 'Rick Astley' });
  });

  it('serves repeated searches from memory instead of calling Discogs again', async () => {
    await request(app).get('/api/catalog/search?q=Astley+Singles').expect(200);
    await request(app).get('/api/catalog/search?q=astley+singles').expect(200);
    expect(ctx.catalogSource.searchCalls).toBe(1);
    await request(app).get('/api/catalog/search?q=astley+singles&page=2').expect(200);
    expect(ctx.catalogSource.searchCalls).toBe(2);
  });

  it('passes format and year filters through, and caches each combination separately', async () => {
    const response = await request(app)
      .get('/api/catalog/search?q=filter+test&format=7in&year=1987')
      .expect(200);
    expect(response.body.filters).toEqual({ format: '7in', year: 1987 });
    expect(ctx.catalogSource.lastSearchFilters).toEqual({ format: '7in', year: 1987 });
    await request(app).get('/api/catalog/search?q=filter+test&format=lp').expect(200);
    await request(app).get('/api/catalog/search?q=filter+test&format=&year=').expect(200);
    expect(ctx.catalogSource.lastSearchFilters).toEqual({});
    expect(ctx.catalogSource.searchCalls).toBe(3);
  });

  it('validates the query', async () => {
    const response = await request(app).get('/api/catalog/search?q=a').expect(400);
    expect(response.body.error.fields).toHaveProperty('q');
    await request(app).get('/api/catalog/search?q=abba&page=99').expect(400);
    const filters = await request(app).get('/api/catalog/search?q=abba&format=cd&year=1850');
    expect(filters.status).toBe(400);
    expect(Object.keys(filters.body.error.fields).sort()).toEqual(['format', 'year']);
  });

  it('answers 503 with a friendly message when Discogs is unavailable', async () => {
    ctx.catalogSource.failWith = new DiscogsUnavailableError('busy', 'rate limited');
    const response = await request(app).get('/api/catalog/search?q=nirvana').expect(503);
    expect(response.body.error).toEqual({
      code: 'CATALOG_UNAVAILABLE',
      message: 'The record catalog is busy right now. Please try again in a minute.',
    });
  });
});

describe('GET /api/releases/:id', () => {
  it('fetches a pressing once, then serves it from the database', async () => {
    const first = await request(app).get('/api/releases/249504').expect(200);
    expect(first.body.release).toMatchObject({
      id: 249504,
      title: 'Never Gonna Give You Up',
      label: 'RCA',
      catno: 'PB 41447',
      formats: ['Vinyl', '7"', '45 RPM', 'Single', 'Stereo'],
    });
    expect(first.body.release.tracklist).toHaveLength(2);
    await request(app).get('/api/releases/249504').expect(200);
    expect(ctx.catalogSource.releaseCalls).toBe(1);

    const { rows } = await ctx.pool.query('SELECT title FROM releases WHERE id = 249504');
    expect(rows).toEqual([{ title: 'Never Gonna Give You Up' }]);
  });

  it('answers 404 for releases Discogs does not have', async () => {
    const response = await request(app).get('/api/releases/1').expect(404);
    expect(response.body.error.message).toBe('Vinyl pressing not found');
  });

  it('rejects IDs that are not positive whole numbers', async () => {
    await request(app).get('/api/releases/abc').expect(400);
    await request(app).get('/api/releases/-5').expect(400);
  });

  it('sends the Discogs image host in the CSP so covers can load', async () => {
    const response = await request(app).get('/api/releases/249504').expect(200);
    expect(response.headers['content-security-policy']).toContain('img-src');
    expect(response.headers['content-security-policy']).toContain('https://i.discogs.com');
  });
});

describe('CatalogService refresh rules', () => {
  function serviceAt(time, source = new FakeCatalogSource()) {
    return {
      source,
      service: new CatalogService({
        pool: ctx.pool,
        source,
        maxAgeMs: CATALOG_MAX_AGE_MS,
        now: () => time.now,
      }),
    };
  }

  it('refreshes a pressing once it is older than the max age', async () => {
    const time = { now: Date.parse('2026-11-02T12:00:00Z') };
    const { source, service } = serviceAt(time);
    await service.getRelease(249504);
    time.now += CATALOG_MAX_AGE_MS - 1;
    await service.getRelease(249504);
    expect(source.releaseCalls).toBe(1);
    time.now += 2;
    const refreshed = await service.getRelease(249504);
    expect(source.releaseCalls).toBe(2);
    expect(refreshed.fetchedAt).toBe(new Date(time.now).toISOString());
  });

  it('shows a stale pressing if Discogs is down, but fails for one it has never seen', async () => {
    const time = { now: Date.parse('2026-11-02T12:00:00Z') };
    const { source, service } = serviceAt(time);
    await service.getRelease(249504);
    time.now += CATALOG_MAX_AGE_MS * 2;
    source.failWith = new DiscogsUnavailableError('down', 'offline');
    await expect(service.getRelease(249504)).resolves.toMatchObject({ id: 249504 });
    await expect(service.getRelease(999)).rejects.toMatchObject({ status: 503 });
  });

  it('makes one Discogs call when many people open a new pressing at once', async () => {
    const { source, service } = serviceAt({ now: Date.now() });
    await Promise.all([1, 2, 3, 4, 5].map(() => service.getRelease(249504)));
    expect(source.releaseCalls).toBe(1);
  });

  it('ensureRelease uses the cache even when it is stale (for copies and orders)', async () => {
    const time = { now: Date.parse('2026-11-02T12:00:00Z') };
    const { source, service } = serviceAt(time);
    await service.ensureRelease(249504);
    time.now += CATALOG_MAX_AGE_MS * 10;
    await service.ensureRelease(249504);
    expect(source.releaseCalls).toBe(1);
  });

  it('refuses non-vinyl releases', async () => {
    const source = new FakeCatalogSource();
    source.getRelease = async () => ({
      id: 42,
      title: 'Nevermind',
      artist: 'Nirvana',
      year: 1991,
      released: null,
      country: 'US',
      label: 'DGC',
      catno: 'DGCD-24425',
      formats: ['CD', 'Album'],
      genres: [],
      styles: [],
      tracklist: [],
      coverUrl: null,
      thumbUrl: null,
      discogsUrl: 'https://www.discogs.com/release/42',
    });
    const { service } = serviceAt({ now: Date.now() }, source);
    await expect(service.getRelease(42)).rejects.toMatchObject({ status: 404 });
  });
});
