import { cover } from '../components/cover.js';
import { marketSection } from '../components/market.js';
import { errorState, loadingState } from '../components/states.js';
import { h, replaceChildren } from '../dom.js';
import { api, ApiError, isAbortError } from '../lib/api.js';
import { live } from '../lib/live.js';
import { isNewerMarket } from '../lib/market.js';
import { documentTitle, formatTags, labelColor, tracksBySide } from '../lib/records.js';
import { session } from '../session.js';

function facts(release) {
  const pressed = [release.country, release.released ?? release.year].filter(Boolean).join(', ');
  const rows = [
    ['Artist', release.artist],
    ['Label', [release.label, release.catno].filter(Boolean).join(', ')],
    ['Pressed', pressed],
    ['Format', formatTags(release.formats, 8).join(', ')],
    ['Genre', [...release.genres, ...release.styles].join(', ')],
  ];
  return h(
    'section',
    { 'aria-labelledby': 'pressing-facts' },
    h('h2', { id: 'pressing-facts', class: 'label subhead' }, 'The Pressing'),
    h(
      'dl',
      { class: 'facts' },
      rows
        .filter(([, value]) => value !== '')
        .flatMap(([term, value]) => [h('dt', {}, term), h('dd', {}, value)]),
    ),
    h(
      'p',
      { class: 'attribution facts-credit' },
      'Release data from ',
      h('a', { href: release.discogsUrl, target: '_blank', rel: 'noopener' }, 'Discogs'),
      '. reVINYL is not affiliated with Discogs.',
    ),
  );
}

function tracks(release) {
  if (release.tracklist.length === 0) return null;
  return h(
    'section',
    { 'aria-labelledby': 'tracks-title' },
    h('h2', { id: 'tracks-title', class: 'label subhead' }, 'Tracks'),
    h(
      'div',
      { class: 'tracks' },
      tracksBySide(release.tracklist).map(({ side, tracks: sideTracks }) =>
        h(
          'ol',
          { 'aria-label': side },
          sideTracks.map((track) =>
            h(
              'li',
              {},
              h('span', { class: 'track-pos' }, track.position),
              h('span', { class: 'track-title' }, track.title),
              h('span', { class: 'track-time' }, track.duration),
            ),
          ),
        ),
      ),
    ),
  );
}

function releaseView(release, market) {
  document.title = documentTitle(release);
  const byline = [
    release.artist,
    release.label && release.catno ? `${release.label} ${release.catno}` : release.label,
    release.year,
  ]
    .filter(Boolean)
    .join(' · ');
  return h(
    'div',
    {},
    h(
      'header',
      { class: 'page-head' },
      h('p', { class: 'kicker' }, 'The Pressing'),
      h(
        'h1',
        { class: 'headline' },
        release.year ? `${release.title}, ${release.year}` : release.title,
      ),
      h('p', { class: 'byline' }, byline),
    ),
    h(
      'div',
      { class: 'release-grid' },
      h(
        'article',
        { class: 'release-record' },
        h(
          'figure',
          {},
          cover(release.coverUrl, `Cover of ${release.title} by ${release.artist}`, {
            size: 'large',
            labelColor: labelColor(release.id),
          }),
          h(
            'figcaption',
            { class: 'cutline' },
            h('span', { class: 'label' }, 'The sleeve. '),
            release.coverUrl ? 'Cover art from Discogs.' : 'No cover art on Discogs yet.',
          ),
        ),
        facts(release),
        tracks(release),
      ),
      market.classifieds,
    ),
    market.report,
  );
}

/**
 * Keep the market current: load it with your own orders marked, then follow the live
 * connection. Your own orders are reloaded when the server says one of them changed,
 * or when you log in or out. Everything stops when you leave the page.
 */
function followMarket(release, market, signal) {
  let latest = null;
  let mine = new Set();
  let wasDisconnected = false;

  async function loadMine() {
    try {
      const response = await api.market(release.id, signal);
      if (signal.aborted) return;
      mine = new Set(response.mine.orderIds);
      if (isNewerMarket(response.market, latest)) latest = response.market;
      market.show(latest, mine);
    } catch (error) {
      if (isAbortError(error) || signal.aborted || latest) return;
      market.showError(
        error instanceof Error ? error.message : 'Could not load the classifieds.',
        () => void loadMine(),
      );
    }
  }

  const stops = [
    live.watch(release.id, (next) => {
      // Two loads can finish out of order; never put an older market over a newer one.
      if (!isNewerMarket(next, latest)) return;
      latest = next;
      market.show(latest, mine);
    }),
    live.onStatus((status) => {
      market.setStatus(status);
      // Back after a drop (or after logging out in another tab): private messages may have
      // been missed, so ask again which ads are yours.
      if (status === 'live' && wasDisconnected) void loadMine();
      wasDisconnected = status === 'reconnecting';
    }),
    live.onPrivate((message) => {
      if (message.releaseId === release.id) void loadMine();
    }),
    session.subscribe(() => {
      market.showCoupons();
      void loadMine();
    }),
  ];
  signal.addEventListener('abort', () => stops.forEach((stop) => stop()), { once: true });
  market.showCoupons();
  void loadMine();
  return { reloadMine: () => void loadMine() };
}

export const releasePage = (ctx) => {
  const id = Number(ctx.params.id);
  const root = h('main', { class: 'page release-page' });

  async function load() {
    replaceChildren(root, loadingState('Pulling the record from the stacks…'));
    try {
      const { release } = await api.release(id, ctx.signal);
      if (ctx.signal.aborted) return;
      let following = null;
      const market = marketSection({
        release,
        user: () => session.user,
        // After you place or cancel an ad: mark your ads again. The market itself
        // arrives over the live connection like everyone else's.
        onPosted: () => following?.reloadMine(),
      });
      replaceChildren(root, releaseView(release, market));
      following = followMarket(release, market, ctx.signal);
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) {
        document.title = 'Pressing not found | reVINYL';
        replaceChildren(
          root,
          h(
            'div',
            { class: 'state state-empty' },
            h('p', { class: 'state-title' }, 'We couldn’t find that vinyl pressing.'),
            h('p', { class: 'state-hint' }, h('a', { href: '/search' }, 'Search the catalog →')),
          ),
        );
        return;
      }
      replaceChildren(
        root,
        errorState(
          error instanceof Error ? error.message : 'Could not load this pressing.',
          () => void load(),
        ),
      );
    }
  }
  void load();
  return root;
};
