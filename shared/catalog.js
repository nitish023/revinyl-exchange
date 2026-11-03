/**
 * The record catalog: shapes for Discogs-backed search results and pressing
 * pages, plus the query schemas the catalog routes parse with.
 * Every pressing is a Discogs release, identified by its numeric release ID.
 */
import { z } from 'zod';

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 100;
/** Discogs pages results; we stop at 20 pages so one search can't drain the rate limit. */
export const SEARCH_MAX_PAGE = 20;
export const SEARCH_PAGE_SIZE = 24;

/** Format filter on search: any vinyl, or only LPs, 12" or 7" records. */
export const SEARCH_FORMATS = ['lp', '12in', '7in'];

export const SEARCH_FORMAT_LABELS = {
  lp: 'LP',
  '12in': '12″',
  '7in': '7″',
};
export const SEARCH_YEAR_MIN = 1900;
export const SEARCH_YEAR_MAX = 2100;

/** Empty query-string values ("?year=") mean "no filter". */
const blankAsMissing = (value) => (value === '' ? undefined : value);

export const catalogSearchQuerySchema = z.object({
  q: z
    .string({ error: 'Type something to search for' })
    .trim()
    .min(SEARCH_QUERY_MIN, `Search needs at least ${SEARCH_QUERY_MIN} characters`)
    .max(SEARCH_QUERY_MAX, `Search must be at most ${SEARCH_QUERY_MAX} characters`),
  page: z.coerce
    .number({ error: 'Page must be a number' })
    .int('Page must be a whole number')
    .min(1, 'Page must be at least 1')
    .max(SEARCH_MAX_PAGE, `Page must be at most ${SEARCH_MAX_PAGE}`)
    .default(1),
  format: z.preprocess(
    blankAsMissing,
    z.enum(SEARCH_FORMATS, { error: 'Format must be LP, 12in or 7in' }).optional(),
  ),
  year: z.preprocess(
    blankAsMissing,
    z.coerce
      .number({ error: 'Year must be a number' })
      .int('Year must be a whole number')
      .min(SEARCH_YEAR_MIN, `Year must be ${SEARCH_YEAR_MIN} or later`)
      .max(SEARCH_YEAR_MAX, `Year must be ${SEARCH_YEAR_MAX} or earlier`)
      .optional(),
  ),
});

export const releaseIdParamSchema = z.object({
  id: z.coerce
    .number({ error: 'Release ID must be a number' })
    .int('Release ID must be a whole number')
    .positive('Release ID must be positive')
    .max(Number.MAX_SAFE_INTEGER),
});

/**
 * Search filters. `year` is one exact release year: Discogs has no decade or range filter.
 * @typedef {{ format?: 'lp' | '12in' | '7in', year?: number }} SearchFilters
 */

/**
 * One row in search results.
 * @typedef {object} ReleaseSummary
 * @property {number} id Discogs release ID
 * @property {string} title
 * @property {string} artist
 * @property {number | null} year
 * @property {string | null} country
 * @property {string | null} label
 * @property {string | null} catno
 * @property {string[]} formats e.g. ["Vinyl", "LP", "Album", "Reissue"]
 * @property {string | null} thumbUrl always on i.discogs.com, or null
 */

/**
 * What GET /api/catalog/search returns.
 * @typedef {object} SearchResults
 * @property {string} query
 * @property {number} page
 * @property {SearchFilters} filters the filters used, so pager links can keep them
 * @property {number} pages
 * @property {number} total
 * @property {ReleaseSummary[]} results
 */

/** @typedef {{ position: string, title: string, duration: string }} Track */

/**
 * A pressing page. Everything here comes from Discogs and is cached by our server.
 * @typedef {object} Release
 * @property {number} id
 * @property {string} title
 * @property {string} artist
 * @property {number | null} year
 * @property {string | null} released
 * @property {string | null} country
 * @property {string | null} label
 * @property {string | null} catno
 * @property {string[]} formats
 * @property {string[]} genres
 * @property {string[]} styles
 * @property {Track[]} tracklist
 * @property {string | null} coverUrl
 * @property {string | null} thumbUrl
 * @property {string} discogsUrl link back to the release on Discogs (required attribution)
 * @property {string} fetchedAt when our server last refreshed it from Discogs (ISO 8601)
 */
