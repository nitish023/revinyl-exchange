import { describe, expect, it } from 'vitest';
import {
  cardMetaLine,
  documentTitle,
  formatTags,
  isSearchable,
  labelColor,
  parseYearFilter,
  readSearchParams,
  releaseMetaLine,
  searchPath,
  tracksBySide,
} from './records.js';

describe('record display helpers', () => {
  it('joins label, catalog number, country and year, skipping unknowns', () => {
    expect(releaseMetaLine({ label: 'RCA', catno: 'PB 41447', country: 'UK', year: 1987 })).toBe(
      'RCA · PB 41447 · UK · 1987',
    );
    expect(releaseMetaLine({ label: null, catno: null, country: 'US', year: null })).toBe('US');
  });

  it('prints a short card line: catalog number, year and size', () => {
    expect(
      cardMetaLine({ catno: 'PB 41447', year: 1987, formats: ['Vinyl', '7"', '45 RPM'] }),
    ).toBe('PB 41447 · 1987 · 7″');
    expect(cardMetaLine({ catno: null, year: null, formats: ['Vinyl'] })).toBe('');
  });

  it('drops the generic "Vinyl" tag and caps the list', () => {
    expect(formatTags(['Vinyl', '7"', '45 RPM', 'Single', 'Stereo'])).toEqual([
      '7"',
      '45 RPM',
      'Single',
      'Stereo',
    ]);
    expect(formatTags(['Vinyl', 'LP', 'Album', 'Reissue', 'Remastered', 'Gatefold'], 3)).toEqual([
      'LP',
      'Album',
      'Reissue',
    ]);
  });

  it('builds and reads search URLs, filters included', () => {
    expect(searchPath('pink floyd')).toBe('/search?q=pink+floyd');
    expect(searchPath('pink floyd', 3)).toBe('/search?q=pink+floyd&page=3');
    expect(searchPath('abba', 2, { format: '7in', year: 1979 })).toBe(
      '/search?q=abba&format=7in&year=1979&page=2',
    );
    expect(readSearchParams(new URLSearchParams('q=+abba+&page=2&format=lp&year=1977'))).toEqual({
      query: 'abba',
      page: 2,
      filters: { format: 'lp', year: 1977 },
    });
    expect(readSearchParams(new URLSearchParams('page=-4'))).toEqual({
      query: '',
      page: 1,
      filters: {},
    });
    expect(readSearchParams(new URLSearchParams('q=x&page=lots&format=cd&year=77'))).toEqual({
      query: 'x',
      page: 1,
      filters: {},
    });
  });

  it('accepts only four-digit years Discogs could match', () => {
    expect(parseYearFilter(' 1979 ')).toBe(1979);
    expect(parseYearFilter('79')).toBeNull();
    expect(parseYearFilter('1850')).toBeNull();
    expect(parseYearFilter('')).toBeNull();
  });

  it('needs at least two characters to search', () => {
    expect(isSearchable(' a ')).toBe(false);
    expect(isSearchable('ab')).toBe(true);
  });

  it('titles pressing pages with artist and title', () => {
    expect(documentTitle({ artist: 'Rick Astley', title: 'Never Gonna Give You Up' })).toBe(
      'Rick Astley – Never Gonna Give You Up | reVINYL',
    );
  });

  it('groups a tracklist by side', () => {
    const track = (position) => ({ position, title: position, duration: '' });
    expect(
      tracksBySide([track('A1'), track('A2'), track('B1'), track('B')]).map((group) => [
        group.side,
        group.tracks.map((t) => t.position),
      ]),
    ).toEqual([
      ['Side A', ['A1', 'A2']],
      ['Side B', ['B1', 'B']],
    ]);
    expect(tracksBySide([track('1'), track('2')])[0]?.side).toBe('Tracks');
  });

  it('gives each record the same label color every time', () => {
    expect(labelColor(249504)).toBe(labelColor(249504));
    expect(labelColor(1)).not.toBe(labelColor(2));
  });
});
