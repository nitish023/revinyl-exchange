import { describe, expect, it } from 'vitest';
import releaseFixture from './fixtures/release-249504.json' with { type: 'json' };
import searchFixture from './fixtures/search-astley.json' with { type: 'json' };
import {
  cleanArtistName,
  imageUrl,
  isVinyl,
  mapRelease,
  mapSearchResponse,
  parseYear,
  splitSearchTitle,
} from './discogsMapping.js';

describe('mapRelease (real Discogs response for release 249504)', () => {
  const release = mapRelease(releaseFixture);

  it('keeps the details a pressing page shows', () => {
    expect(release).toMatchObject({
      id: 249504,
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      year: 1987,
      released: 'Jul 1987',
      country: 'UK',
      label: 'RCA',
      catno: 'PB 41447',
      genres: ['Electronic', 'Pop'],
      styles: ['Euro-Disco'],
      discogsUrl: 'https://www.discogs.com/release/249504-Rick-Astley-Never-Gonna-Give-You-Up',
    });
  });

  it('flattens formats and keeps only real tracks', () => {
    expect(release.formats).toEqual(['Vinyl', '7"', '45 RPM', 'Single', 'Stereo']);
    expect(release.tracklist).toEqual([
      { position: 'A', title: 'Never Gonna Give You Up', duration: '3:32' },
      { position: 'B', title: 'Never Gonna Give You Up (Instrumental)', duration: '3:30' },
    ]);
    expect(isVinyl(release)).toBe(true);
  });

  it('uses the primary image as the cover', () => {
    expect(release.coverUrl).toMatch(/^https:\/\/i\.discogs\.com\/-DPFA5/);
    expect(release.thumbUrl).toMatch(/^https:\/\/i\.discogs\.com\/HG2xCh/);
  });

  it('never copies Discogs marketplace prices into our data', () => {
    expect(JSON.stringify(release)).not.toContain('lowest_price');
    expect(release).not.toHaveProperty('lowestPrice');
  });

  it('builds a multi-artist credit from join words', () => {
    const credit = mapRelease({
      ...releaseFixture,
      artists: [
        { name: 'Simon (3)', anv: '', join: '&' },
        { name: 'Garfunkel', anv: '', join: '' },
      ],
    }).artist;
    expect(credit).toBe('Simon & Garfunkel');
  });

  it('rejects responses without a usable ID', () => {
    expect(mapRelease({ title: 'No id' })).toBeNull();
    expect(mapRelease('not an object')).toBeNull();
  });
});

describe('mapSearchResponse', () => {
  const results = mapSearchResponse(searchFixture, 'rick astley', 1);

  it('maps pagination and splits "Artist - Title"', () => {
    expect(results).toMatchObject({ query: 'rick astley', page: 1, pages: 3, total: 61 });
    expect(results.results[0]).toEqual({
      id: 249504,
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      year: 1987,
      country: 'UK',
      label: 'RCA',
      catno: 'PB 41447',
      formats: ['Vinyl', '7"', '45 RPM', 'Single', 'Stereo'],
      thumbUrl: expect.stringMatching(/^https:\/\/i\.discogs\.com\//),
    });
  });

  it('handles missing year, label, catalog number and placeholder images', () => {
    expect(results.results[1]).toMatchObject({
      artist: 'Rick Astley',
      year: null,
      label: null,
      catno: null,
      thumbUrl: null,
    });
  });

  it('copes with an empty or malformed response', () => {
    expect(mapSearchResponse({}, 'x', 1)).toEqual({
      query: 'x',
      page: 1,
      filters: {},
      pages: 0,
      total: 0,
      results: [],
    });
    expect(mapSearchResponse(null, 'x', 1).results).toEqual([]);
  });

  it('drops anything that is not vinyl, even if Discogs matched it', () => {
    const shellac = {
      results: [
        { type: 'release', id: 1, title: 'A - Shellac', format: ['Shellac', '10"'] },
        { type: 'release', id: 2, title: 'B - Record', format: ['Vinyl', '7"'] },
      ],
    };
    const mapped = mapSearchResponse(shellac, 'x', 1, { format: '7in' });
    expect(mapped.results.map((result) => result.id)).toEqual([2]);
    expect(mapped.filters).toEqual({ format: '7in' });
  });
});

describe('helpers', () => {
  it('parses years from numbers and strings', () => {
    expect(parseYear(1987)).toBe(1987);
    expect(parseYear('1991')).toBe(1991);
    expect(parseYear('')).toBeNull();
    expect(parseYear(0)).toBeNull();
  });

  it('removes Discogs disambiguation suffixes', () => {
    expect(cleanArtistName('Nirvana (2)')).toBe('Nirvana');
    expect(cleanArtistName('Prince*')).toBe('Prince');
  });

  it('only allows images from i.discogs.com over https', () => {
    expect(imageUrl('https://i.discogs.com/abc.jpeg')).toBe('https://i.discogs.com/abc.jpeg');
    expect(imageUrl('http://i.discogs.com/abc.jpeg')).toBeNull();
    expect(imageUrl('https://evil.example/abc.jpeg')).toBeNull();
    expect(imageUrl('javascript:alert(1)')).toBeNull();
    expect(imageUrl('https://i.discogs.com/images/spacer.gif')).toBeNull();
  });

  it('keeps everything as the title when there is no artist separator', () => {
    expect(splitSearchTitle('Untitled')).toEqual({ artist: 'Unknown artist', title: 'Untitled' });
  });
});
