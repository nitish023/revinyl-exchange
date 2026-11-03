import { gradeScale } from '../components/gradeScale.js';
import { searchBox } from '../components/searchBox.js';
import { h } from '../dom.js';
import { isSearchable, searchPath } from '../lib/records.js';

/**
 * The front page. For now it explains how reVINYL works; the lead record, the
 * "First Shelf" picks and the reVINYL 30 chart replace most of this in Part 8,
 * once there are real copies and trades to report on.
 */
const COLUMNS = [
  [
    'Find the exact pressing',
    'Every pressing gets its own page. The 1977 original and the 2020 reissue are different records, with different ads and different prices.',
  ],
  [
    'Read the classifieds',
    'Each copy for sale is its own ad, with the seller’s photos, their note on how it plays, and its grade. The cheapest copy in each grade comes first.',
  ],
  [
    'Run a wanted ad',
    'Can’t find the right copy? Say what you’ll pay and the lowest grade you’ll take. When a copy that good turns up at your price, it’s yours.',
  ],
];

const GLOSSARY = [
  ['NM · Near Mint', 'Looks and plays like new. Maybe played a handful of times.'],
  ['VG+ · Very Good Plus', 'Light marks you can see but not hear. What most collectors buy.'],
  ['VG · Very Good', 'Some surface noise in quiet parts, but it plays all the way through.'],
  ['G · Good', 'Noisy, but it plays. Fine for a record you just want to hear.'],
];

export const homePage = (ctx) => {
  document.title = 'reVINYL: records you choose';
  return h(
    'main',
    { class: 'page home' },
    h(
      'section',
      { class: 'front-banner' },
      h('p', { class: 'label' }, 'Welcome to reVINYL'),
      h('h1', { class: 'banner' }, 'Pick up a record. Listen all the way through.'),
      h(
        'p',
        { class: 'deck' },
        'Search any vinyl pressing on Discogs, read the ads for real copies, and buy or sell them with play money.',
      ),
      h(
        'div',
        { class: 'front-search' },
        searchBox({
          value: '',
          onSubmit: (query) => {
            if (isSearchable(query)) ctx.navigate(searchPath(query));
          },
        }),
      ),
    ),
    h(
      'section',
      { class: 'front-how', 'aria-labelledby': 'how-title' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { id: 'how-title' }, 'How it works'),
        h('p', {}, 'Two minutes to read'),
      ),
      h(
        'div',
        { class: 'columns-3' },
        COLUMNS.map(([title, body]) =>
          h(
            'article',
            {},
            h('h3', { class: 'column-head' }, title),
            h('p', { class: 'column-body' }, body),
          ),
        ),
      ),
    ),
    h(
      'section',
      { class: 'front-grades', 'aria-labelledby': 'grades-title' },
      h(
        'div',
        { class: 'section-head' },
        h('h2', { id: 'grades-title' }, 'How condition works'),
        h('p', {}, 'The grade is for the record, not the sleeve'),
      ),
      gradeScale(),
      h(
        'dl',
        { class: 'grade-glossary' },
        GLOSSARY.map(([term, meaning]) => h('div', {}, h('dt', {}, term), h('dd', {}, meaning))),
      ),
    ),
  );
};
