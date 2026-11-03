/** Pure display helpers for releases, shared by search results and pressing pages. */
import {
  SEARCH_FORMATS,
  SEARCH_QUERY_MIN,
  SEARCH_YEAR_MAX,
  SEARCH_YEAR_MIN,
} from '../../../shared/index.js';

/** "RCA · PB 41447 · UK · 1987", skipping whatever Discogs doesn't know. */
export function releaseMetaLine(release) {
  return [release.label, release.catno, release.country, release.year]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
}

/** The short line under a record card: "PB 41447 · 1987 · 7″". */
export function cardMetaLine(release) {
  const size = formatTags(release.formats, 1)[0]?.replace('"', '″');
  return [release.catno, release.year, size]
    .filter((part) => part !== null && part !== undefined && part !== '')
    .join(' · ');
}

/** Drop the generic "Vinyl" so the interesting bits show: 7", 45 RPM, Reissue... */
export function formatTags(formats, max = 4) {
  return formats.filter((format) => format.toLowerCase() !== 'vinyl').slice(0, max);
}

export function releasePath(id) {
  return `/release/${id}`;
}

export function searchPath(query, page = 1, filters = {}) {
  const params = new URLSearchParams({ q: query });
  if (filters.format) params.set('format', filters.format);
  if (filters.year !== undefined) params.set('year', String(filters.year));
  if (page > 1) params.set('page', String(page));
  return `/search?${params}`;
}

export function isSearchFormat(value) {
  return SEARCH_FORMATS.includes(value);
}

/** A year typed into the filter, or null if it isn't one Discogs could match. */
export function parseYearFilter(value) {
  if (!/^\d{4}$/.test(value.trim())) return null;
  const year = Number(value);
  return year >= SEARCH_YEAR_MIN && year <= SEARCH_YEAR_MAX ? year : null;
}

/** Read ?q=, ?page=, ?format= and ?year= from the address bar, dropping junk. */
export function readSearchParams(params) {
  const query = (params.get('q') ?? '').trim();
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const filters = {};
  const format = params.get('format') ?? '';
  if (isSearchFormat(format)) filters.format = format;
  const year = parseYearFilter(params.get('year') ?? '');
  if (year !== null) filters.year = year;
  return { query, page: Number.isInteger(page) && page >= 1 ? page : 1, filters };
}

export function isSearchable(query) {
  return query.trim().length >= SEARCH_QUERY_MIN;
}

export function documentTitle(release) {
  return `${release.artist} – ${release.title} | reVINYL`;
}

/**
 * Split a tracklist by side, the way it's printed on a record: positions
 * "A1", "A2", "B1" become Side A and Side B. Positions without a side letter
 * (some releases just number tracks) stay together under "Tracks".
 */
export function tracksBySide(tracks) {
  const groups = new Map();
  for (const track of tracks) {
    const letter = /^([A-Z])(?:\d|$|[.-])/i.exec(track.position.trim())?.[1]?.toUpperCase();
    const side = letter ? `Side ${letter}` : 'Tracks';
    const group = groups.get(side);
    if (group) group.push(track);
    else groups.set(side, [track]);
  }
  return [...groups].map(([side, grouped]) => ({ side, tracks: grouped }));
}

/** Record label colors for the disc behind each sleeve, picked by release ID so a record keeps its color. */
const LABEL_COLORS = ['#e9a23b', '#d9543a', '#e8e1d3', '#9ccbd8', '#c8b26a', '#b7472a', '#7fa36b'];

export function labelColor(id) {
  return LABEL_COLORS[Math.abs(id) % LABEL_COLORS.length];
}
