import { gradeFromDiscogs } from '../../../shared/collection.js';

/**
 * Turns raw Discogs JSON into our DTOs. Pure functions, so they're easy to test
 * against real responses saved in ./fixtures. Discogs data is user-contributed
 * and loosely typed, so every field is read defensively.
 */

const DISCOGS_SITE = 'https://www.discogs.com';

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function textList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const item of value) {
    const entry = text(item);
    if (entry) seen.add(entry);
  }
  return [...seen];
}

function objects(value) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/** Discogs years come as numbers on releases and strings ("1987" or "") in search. */
export function parseYear(value) {
  const year = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(year) && year >= 1880 && year <= 2100 ? year : null;
}

/** Discogs adds " (2)" to tell apart artists with the same name; people don't want to see it. */
export function cleanArtistName(name) {
  return name
    .replace(/\s\(\d+\)$/, '')
    .replace(/\*$/, '')
    .trim();
}

/** Only images on Discogs' own image host; anything else is dropped (our CSP only allows that host). */
export function imageUrl(value) {
  const url = text(value);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'i.discogs.com') return null;
    if (parsed.pathname.endsWith('/spacer.gif')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** "Rick Astley - Never Gonna Give You Up" -> artist and title. */
export function splitSearchTitle(value) {
  const separator = value.indexOf(' - ');
  if (separator === -1) return { artist: 'Unknown artist', title: value };
  return {
    artist: cleanArtistName(value.slice(0, separator)),
    title: value.slice(separator + 3).trim(),
  };
}

function positiveId(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function mapSearchResult(raw) {
  if (!isObject(raw) || raw.type !== 'release') return null;
  const id = positiveId(raw.id);
  const fullTitle = text(raw.title);
  if (id === null || !fullTitle) return null;
  const { artist, title } = splitSearchTitle(fullTitle);
  const catno = text(raw.catno);
  return {
    id,
    title,
    artist,
    year: parseYear(raw.year),
    country: text(raw.country),
    label: textList(raw.label)[0] ?? null,
    catno: catno && catno.toLowerCase() !== 'none' ? catno : null,
    formats: textList(raw.format),
    thumbUrl: imageUrl(raw.thumb) ?? imageUrl(raw.cover_image),
  };
}

export function mapSearchResponse(raw, query, page, filters = {}) {
  const body = isObject(raw) ? raw : {};
  const pagination = isObject(body.pagination) ? body.pagination : {};
  // A format filter like "7\"" can also match shellac or lathe cuts, so keep vinyl only.
  const results = (Array.isArray(body.results) ? body.results : [])
    .map(mapSearchResult)
    .filter((result) => result !== null && isVinyl(result));
  const pages = typeof pagination.pages === 'number' ? pagination.pages : results.length ? 1 : 0;
  const total = typeof pagination.items === 'number' ? pagination.items : results.length;
  return { query, page, filters, pages, total, results };
}

function artistCredit(raw) {
  const artists = objects(raw);
  if (artists.length === 0) return 'Unknown artist';
  let credit = '';
  for (const [index, artist] of artists.entries()) {
    const name = cleanArtistName(text(artist.anv) ?? text(artist.name) ?? 'Unknown artist');
    credit += name;
    if (index < artists.length - 1) {
      const join = text(artist.join) ?? ',';
      credit += join === ',' ? ', ' : ` ${join} `;
    }
  }
  return credit;
}

function formatList(raw) {
  const formats = new Set();
  for (const format of objects(raw)) {
    const name = text(format.name);
    if (name) formats.add(name);
    for (const description of textList(format.descriptions)) formats.add(description);
  }
  return [...formats];
}

function tracklist(raw) {
  return objects(raw)
    .filter((track) => (text(track.type_) ?? 'track') === 'track')
    .map((track) => ({
      position: text(track.position) ?? '',
      title: text(track.title) ?? 'Untitled',
      duration: text(track.duration) ?? '',
    }));
}

function coverImage(raw) {
  const images = objects(raw);
  const primary = images.find((image) => image.type === 'primary') ?? images[0];
  return primary ? imageUrl(primary.uri) : null;
}

function discogsUrl(raw, id) {
  const uri = text(raw.uri);
  if (uri?.startsWith(`${DISCOGS_SITE}/`)) return uri;
  return `${DISCOGS_SITE}/release/${id}`;
}

/** Map a /releases/:id response. `fetchedAt` is set by the caller (CatalogService). */
export function mapRelease(raw) {
  if (!isObject(raw)) return null;
  const id = positiveId(raw.id);
  if (id === null) return null;
  const label = objects(raw.labels)[0];
  const catno = label ? text(label.catno) : null;
  const images = objects(raw.images);
  return {
    id,
    title: text(raw.title) ?? 'Untitled',
    artist: artistCredit(raw.artists),
    year: parseYear(raw.year),
    released: text(raw.released_formatted) ?? text(raw.released),
    country: text(raw.country),
    label: label ? (text(label.name) ? cleanArtistName(text(label.name)) : null) : null,
    catno: catno && catno.toLowerCase() !== 'none' ? catno : null,
    formats: formatList(raw.formats),
    genres: textList(raw.genres),
    styles: textList(raw.styles),
    tracklist: tracklist(raw.tracklist),
    coverUrl: coverImage(images),
    thumbUrl: imageUrl(raw.thumb) ?? (images[0] ? imageUrl(images[0].uri150) : null),
    discogsUrl: discogsUrl(raw, id),
  };
}

/** True when the release has at least one vinyl format; we only trade vinyl. */
export function isVinyl(release) {
  return release.formats.some((format) => format.toLowerCase() === 'vinyl');
}

/**
 * Which of a collection's note fields hold the media and sleeve condition. Discogs lets
 * people rename and reorder fields, so they're found by name ("Media Condition",
 * "Sleeve Condition" by default), and only dropdowns count.
 * @returns {{ media: number | null, sleeve: number | null }}
 */
export function conditionFieldIds(raw) {
  const dropdowns = objects(isObject(raw) ? raw.fields : null).filter(
    (field) => field.type === 'dropdown' && positiveId(field.id) !== null,
  );
  const named = (pattern) => dropdowns.find((field) => pattern.test(text(field.name) ?? ''))?.id;
  return { media: named(/media/i) ?? null, sleeve: named(/sleeve/i) ?? null };
}

/**
 * One item of a Discogs collection. A collection only carries the release's basic
 * information (no tracklist), which is enough for the import list and a first copy of the
 * pressing page; the full release is fetched the first time someone opens that page.
 * @param {unknown} raw
 * @param {{ media: number | null, sleeve: number | null }} fieldIds
 */
export function mapCollectionItem(raw, fieldIds) {
  if (!isObject(raw) || !isObject(raw.basic_information)) return null;
  const info = raw.basic_information;
  const id = positiveId(info.id);
  const instanceId = positiveId(raw.instance_id);
  if (id === null || instanceId === null) return null;
  const label = objects(info.labels)[0];
  const catno = label ? text(label.catno) : null;
  const notes = objects(raw.notes);
  const note = (fieldId) =>
    fieldId === null ? undefined : notes.find((entry) => entry.field_id === fieldId)?.value;
  const grade = gradeFromDiscogs(note(fieldIds.media));
  const sleeve = gradeFromDiscogs(note(fieldIds.sleeve));
  const release = {
    id,
    title: text(info.title) ?? 'Untitled',
    artist: artistCredit(info.artists),
    year: parseYear(info.year),
    released: null,
    country: null,
    label: label && text(label.name) ? cleanArtistName(text(label.name)) : null,
    catno: catno && catno.toLowerCase() !== 'none' ? catno : null,
    formats: formatList(info.formats),
    genres: textList(info.genres),
    styles: textList(info.styles),
    tracklist: [],
    coverUrl: imageUrl(info.cover_image),
    thumbUrl: imageUrl(info.thumb) ?? imageUrl(info.cover_image),
    discogsUrl: `${DISCOGS_SITE}/release/${id}`,
  };
  return {
    instanceId,
    addedAt: text(raw.date_added),
    release,
    // A media grade of null can't happen (only sleeves are "Generic"), so null means "not graded".
    grade: typeof grade === 'number' ? grade : null,
    // A number, 'generic' for a generic or missing sleeve, or null when it isn't graded.
    sleeveGrade: sleeve === null ? 'generic' : (sleeve ?? null),
  };
}

/** One page of GET /users/:username/collection/folders/0/releases. */
export function mapCollectionPage(raw, fieldIds) {
  const body = isObject(raw) ? raw : {};
  const pagination = isObject(body.pagination) ? body.pagination : {};
  const items = objects(body.releases)
    .map((item) => mapCollectionItem(item, fieldIds))
    .filter((item) => item !== null);
  return {
    items,
    page: typeof pagination.page === 'number' ? pagination.page : 1,
    pages: typeof pagination.pages === 'number' ? pagination.pages : 1,
    total: typeof pagination.items === 'number' ? pagination.items : items.length,
  };
}
