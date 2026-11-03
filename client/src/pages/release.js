import { cover } from '../components/cover.js';
import { gradeScale } from '../components/gradeScale.js';
import { errorState, loadingState } from '../components/states.js';
import { h, replaceChildren } from '../dom.js';
import { api, ApiError, isAbortError } from '../lib/api.js';
import { documentTitle, formatTags, labelColor, tracksBySide } from '../lib/records.js';

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

/** The market side. Copies for sale and wanted ads arrive in Part 4; until then it explains the grades. */
function classifieds() {
  return h(
    'section',
    { class: 'release-market', 'aria-labelledby': 'classifieds-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'classifieds-title' }, 'Classifieds'),
      h('p', {}, 'Cheapest first in each grade'),
    ),
    h(
      'div',
      { class: 'market-guide' },
      gradeScale(),
      h(
        'p',
        {},
        'Grades run Poor to Mint. Most collectors buy ',
        h('b', {}, 'VG+'),
        ' or better: marks you can see but not hear.',
      ),
    ),
    h(
      'div',
      { class: 'market-empty' },
      h('p', { class: 'state-title' }, 'No copies on the shelf yet'),
      h(
        'p',
        { class: 'state-hint' },
        'Copies for sale and wanted ads for this pressing will run here, cheapest first.',
      ),
    ),
  );
}

function releaseView(release) {
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
      classifieds(),
    ),
  );
}

export const releasePage = (ctx) => {
  const id = Number(ctx.params.id);
  const root = h('main', { class: 'page release-page' });

  async function load() {
    replaceChildren(root, loadingState('Pulling the record from the stacks…'));
    try {
      const { release } = await api.release(id, ctx.signal);
      if (!ctx.signal.aborted) replaceChildren(root, releaseView(release));
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
