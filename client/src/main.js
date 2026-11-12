// The four newspaper typefaces, bundled with the site (no calls to Google Fonts).
import '@fontsource/league-gothic/400.css';
import '@fontsource/libre-franklin/400.css';
import '@fontsource/libre-franklin/600.css';
import '@fontsource/libre-franklin/700.css';
import '@fontsource/libre-franklin/800.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/400-italic.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/old-standard-tt/400.css';
import '@fontsource/old-standard-tt/400-italic.css';
import '@fontsource/old-standard-tt/700.css';
import './styles.css';
import { masthead, siteFooter } from './components/masthead.js';
import { h, replaceChildren } from './dom.js';
import { live } from './lib/live.js';
import { loginPage, registerPage } from './pages/auth.js';
import { homePage } from './pages/home.js';
import { notFoundPage } from './pages/notFound.js';
import { releasePage } from './pages/release.js';
import { roomPage } from './pages/room.js';
import { roomImportPage } from './pages/roomImport.js';
import { searchPage } from './pages/search.js';
import { matchRoute, router } from './router.js';
import { session } from './session.js';

const PAGES = {
  home: homePage,
  search: searchPage,
  release: releasePage,
  login: loginPage,
  register: registerPage,
  room: roomPage,
  roomImport: roomImportPage,
  // Old links to Your Crate open the Listening Room, which replaced it.
  crate: (ctx) => {
    queueMicrotask(() => ctx.navigate('/room', { replace: true }));
    return h('main', { class: 'page' });
  },
  notFound: notFoundPage,
};

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app element in index.html');

const header = masthead();
const outlet = h('div', { class: 'outlet' });
replaceChildren(app, header.element, outlet, siteFooter());

let current = null;
let lastPath = '';

router.onChange((url) => {
  current?.abort();
  current = new AbortController();
  const route = matchRoute(url.pathname);
  header.showRoute(route.name);
  replaceChildren(
    outlet,
    PAGES[route.name]({
      params: route.params,
      query: url.searchParams,
      signal: current.signal,
      navigate: (to, options) => router.navigate(to, options),
    }),
  );
  // Only jump to the top on a real page change, not when the search query updates.
  if (url.pathname !== lastPath) window.scrollTo(0, 0);
  lastPath = url.pathname;
});

await session.load();
// The live connection knows who you are from the cookie it opened with.
let lastUserId = session.user?.id ?? null;
session.subscribe((user) => {
  if ((user?.id ?? null) === lastUserId) return;
  lastUserId = user?.id ?? null;
  live.reconnect();
});
router.start();
