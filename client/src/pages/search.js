import { SEARCH_FORMAT_LABELS, SEARCH_FORMATS, SEARCH_MAX_PAGE } from '../../../shared/index.js';
import { cover } from '../components/cover.js';
import { searchBox } from '../components/searchBox.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { debounce } from '../lib/debounce.js';
import {
  cardMetaLine,
  isSearchable,
  labelColor,
  parseYearFilter,
  readSearchParams,
  releasePath,
  searchPath,
} from '../lib/records.js';

function resultCard(release) {
  const meta = cardMetaLine(release);
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'record-card', href: releasePath(release.id) },
      cover(release.thumbUrl, `Cover of ${release.title}`, {
        size: 'thumb',
        labelColor: labelColor(release.id),
      }),
      h(
        'div',
        {},
        h('h2', { class: 'record-title' }, release.title),
        h('p', { class: 'record-artist' }, release.artist),
        meta ? h('p', { class: 'record-meta' }, meta) : null,
      ),
    ),
  );
}

/** "7″ records from 1979", or "every format, every year". */
function describeFilters(filters) {
  const format = filters.format
    ? `${SEARCH_FORMAT_LABELS[filters.format]} records`
    : 'Every format';
  const year = filters.year ? `from ${filters.year}` : 'every year';
  return filters.format ? `${format} ${year}` : `${format}, ${year}`;
}

function pager(results) {
  const lastPage = Math.min(results.pages, SEARCH_MAX_PAGE);
  if (lastPage <= 1) return null;
  const { query, page, filters } = results;
  return h(
    'nav',
    { class: 'pager', 'aria-label': 'Result pages' },
    h('span', { class: 'label' }, `Page ${page} of ${lastPage}`),
    h(
      'span',
      { class: 'pager-links' },
      page > 1 ? h('a', { href: searchPath(query, page - 1, filters) }, '← Back a page') : null,
      page > 1 && page < lastPage ? '   ' : null,
      page < lastPage
        ? h('a', { href: searchPath(query, page + 1, filters) }, 'Keep digging →')
        : null,
    ),
  );
}

function withoutYear(filters) {
  const next = { ...filters };
  delete next.year;
  return next;
}

/** Format links and the year box. Each choice is a real link, so it works with the back button. */
function filterBar(state, navigate) {
  const { query, filters } = state;
  const formatLink = (label, format) => {
    const next = { ...filters };
    if (format) next.format = format;
    else delete next.format;
    return h(
      'a',
      {
        href: searchPath(query, 1, next),
        'aria-current': (filters.format ?? null) === (format ?? null) ? 'true' : null,
      },
      label,
    );
  };

  const yearInput = h('input', {
    id: 'year-filter',
    name: 'year',
    inputmode: 'numeric',
    maxlength: 4,
    placeholder: 'e.g. 1979',
    'aria-describedby': 'year-filter-hint',
  });
  yearInput.value = filters.year ? String(filters.year) : '';
  const yearForm = h(
    'form',
    { class: 'year-filter' },
    h('label', { for: 'year-filter', class: 'label' }, 'Year'),
    yearInput,
    h('button', { type: 'submit' }, 'Apply'),
    filters.year ? h('a', { href: searchPath(query, 1, withoutYear(filters)) }, 'any year') : null,
    h('span', { id: 'year-filter-hint', class: 'visually-hidden' }, 'Four digits, like 1979'),
  );
  yearForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const typed = yearInput.value.trim();
    const year = parseYearFilter(typed);
    if (typed !== '' && year === null) {
      yearInput.setAttribute('aria-invalid', 'true');
      yearInput.focus();
      return;
    }
    navigate(searchPath(query, 1, year === null ? withoutYear(filters) : { ...filters, year }));
  });

  return h(
    'div',
    { class: 'filters' },
    h(
      'div',
      { class: 'filter-group', role: 'group', 'aria-label': 'Format' },
      h('span', { class: 'label', 'aria-hidden': 'true' }, 'Format'),
      formatLink('Any', undefined),
      SEARCH_FORMATS.map((format) => formatLink(SEARCH_FORMAT_LABELS[format], format)),
    ),
    yearForm,
  );
}

function setTitle(query) {
  document.title = query ? `${query} | reVINYL search` : 'Search the catalog | reVINYL';
}

export const searchPage = (ctx) => {
  let state = readSearchParams(ctx.query);
  setTitle(state.query);
  const output = h('div', { class: 'search-output', 'aria-live': 'polite' });
  // The filter links carry the query, so they're rebuilt whenever it changes.
  const filters = h('div');
  const renderFilters = () =>
    replaceChildren(
      filters,
      filterBar(state, (to) => ctx.navigate(to)),
    );
  renderFilters();
  let inFlight = null;

  // Typing updates the results and the address bar in place, so the search box keeps focus.
  const searchFor = (value) => {
    const query = value.trim();
    if (query === state.query && state.page === 1) return;
    if (query !== '' && !isSearchable(query)) return;
    state = { query, page: 1, filters: state.filters };
    window.history.replaceState(null, '', query ? searchPath(query, 1, state.filters) : '/search');
    setTitle(query);
    renderFilters();
    void load();
  };
  const typed = debounce(searchFor, 450);
  ctx.signal.addEventListener('abort', () => {
    typed.cancel();
    inFlight?.abort();
  });

  async function load() {
    inFlight?.abort();
    const { query, page, filters } = state;
    if (!isSearchable(query)) {
      replaceChildren(
        output,
        emptyState(
          'What are you looking for?',
          'Try an artist, an album title, or a catalog number like “PB 41447”.',
        ),
      );
      return;
    }
    inFlight = new AbortController();
    const signal = AbortSignal.any([ctx.signal, inFlight.signal]);
    replaceChildren(output, loadingState('Going through the stacks…'));
    try {
      const results = await api.searchCatalog(query, page, filters, signal);
      if (signal.aborted) return;
      if (results.results.length === 0) {
        replaceChildren(
          output,
          emptyState(
            `No vinyl found for “${query}”`,
            filters.format || filters.year
              ? 'Try clearing the format or year, or check the spelling.'
              : 'Check the spelling, or try fewer words.',
          ),
        );
        return;
      }
      replaceChildren(
        output,
        h(
          'div',
          { class: 'result-count' },
          h(
            'strong',
            {},
            h('b', {}, results.total.toLocaleString()),
            ` vinyl ${results.total === 1 ? 'pressing matches' : 'pressings match'} “${query}”`,
          ),
          h('span', {}, describeFilters(results.filters)),
        ),
        h('ol', { class: 'record-grid' }, results.results.map(resultCard)),
        pager(results),
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      replaceChildren(
        output,
        errorState(error instanceof Error ? error.message : 'Search failed.', () => void load()),
      );
    }
  }
  void load();

  return h(
    'main',
    { class: 'page search-page' },
    h(
      'div',
      { class: 'page-head' },
      h('h1', { class: 'kicker' }, 'Search the Catalog'),
      h(
        'p',
        { class: 'deck' },
        'Every vinyl pressing on Discogs, whether or not it’s on our shelf yet.',
      ),
    ),
    searchBox({ value: state.query, autofocus: !state.query, onInput: typed, onSubmit: searchFor }),
    filters,
    output,
  );
};
