import { h, replaceChildren } from '../dom.js';
import { editionDate, issueNumber } from '../lib/edition.js';
import { router } from '../router.js';
import { session } from '../session.js';

/** The section links under the nameplate, and which routes light each one up. */
const SECTIONS = [
  { label: 'The Shelf', href: '/', routes: ['home'] },
  { label: 'Search the Catalog', href: '/search', routes: ['search'] },
];

function accountLinks(user) {
  if (!user) {
    return [h('a', { href: '/login' }, 'Log in'), h('a', { href: '/register' }, 'Sign up')];
  }
  const logout = h('button', { type: 'button' }, 'Log out');
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await session.logout();
      router.navigate('/');
    } finally {
      logout.disabled = false;
    }
  });
  return [
    h('a', { href: '/room' }, 'Listening Room'),
    h('span', { class: 'masthead-user' }, user.displayName),
    logout,
  ];
}

/**
 * The top of every page: date, nameplate, account links, the double rule and
 * the section links. The front page gets the big nameplate, the slogan and a
 * folio line, like the front of a paper; inside pages get a compact one.
 */
export function masthead(now = () => new Date()) {
  const date = h('span', { class: 'masthead-date' });
  const folioDate = h('span');
  const folioIssue = h('span');
  const account = h('div', { class: 'masthead-account' });
  const renderAccount = (user) => replaceChildren(account, accountLinks(user));
  session.subscribe(renderAccount);
  renderAccount(session.user);

  const links = SECTIONS.map((section) => ({
    section,
    link: h('a', { href: section.href }, section.label),
  }));

  const element = h(
    'header',
    { class: 'masthead page' },
    h(
      'div',
      { class: 'masthead-top' },
      date,
      h(
        'a',
        { href: '/', class: 'nameplate', 'aria-label': 'reVINYL, front page' },
        h('span', { class: 'nameplate-re' }, 're'),
        h('span', { class: 'nameplate-vinyl' }, 'VINYL'),
      ),
      account,
    ),
    h('div', { class: 'masthead-folio' }, folioIssue, folioDate, h('span', {}, 'Play money only')),
    h('div', { class: 'rule-double', role: 'presentation' }),
    h(
      'nav',
      { class: 'section-links', 'aria-label': 'Sections' },
      links.map(({ link }) => link),
    ),
  );

  function showRoute(route) {
    const today = now();
    const front = route === 'home';
    element.classList.toggle('masthead--front', front);
    // On the front page the date moves into the folio line and the slogan takes its place.
    if (front) {
      replaceChildren(date, 'Records you choose,', h('br'), 'not music that plays at you.');
    } else {
      replaceChildren(date, editionDate(today));
    }
    folioIssue.textContent = `Vol. I · No. ${issueNumber(today)}`;
    folioDate.textContent = editionDate(today);
    for (const { section, link } of links) {
      if (section.routes.includes(route)) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }

  return { element, showRoute };
}

/** The bottom of every page. */
export function siteFooter() {
  return h(
    'footer',
    { class: 'page' },
    h(
      'p',
      { class: 'site-footer' },
      'Release data and covers from ',
      h('a', { href: 'https://www.discogs.com', target: '_blank', rel: 'noopener' }, 'Discogs'),
      '. reVINYL is not affiliated with Discogs. Play money only: nothing here costs real dollars.',
    ),
  );
}
