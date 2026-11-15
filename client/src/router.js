/**
 * A small History API router. Routes are matched by a pure function (tested),
 * and links with a same-origin href are intercepted so navigation doesn't
 * reload the page.
 */

const ROUTES = [
  { name: 'home', pattern: /^\/$/ },
  { name: 'search', pattern: /^\/search\/?$/ },
  { name: 'release', pattern: /^\/release\/(\d{1,15})\/?$/, keys: ['id'] },
  { name: 'login', pattern: /^\/login\/?$/ },
  { name: 'register', pattern: /^\/register\/?$/ },
  { name: 'room', pattern: /^\/room\/?$/ },
  { name: 'roomImport', pattern: /^\/room\/import\/?$/ },
  // The old Your Crate page lives on in the Listening Room.
  { name: 'crate', pattern: /^\/crate\/?$/ },
];

export function matchRoute(pathname) {
  for (const route of ROUTES) {
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params = {};
    route.keys?.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] ?? '');
    });
    return { name: route.name, params };
  }
  return { name: 'notFound', params: {} };
}

/** Only follow plain left-clicks on same-origin links; let the browser handle the rest. */
export function shouldIntercept(event, anchor, origin) {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const url = new URL(anchor.href, origin);
  return url.origin === origin && !url.pathname.startsWith('/api');
}

export class Router {
  listeners = new Set();

  start() {
    window.addEventListener('popstate', () => this.emit());
    document.addEventListener('click', (event) => {
      const anchor = event.target?.closest('a');
      if (!anchor || !shouldIntercept(event, anchor, window.location.origin)) return;
      event.preventDefault();
      this.navigate(anchor.href);
    });
    this.emit();
  }

  onChange(listener) {
    this.listeners.add(listener);
  }

  navigate(to, options = {}) {
    const url = new URL(to, window.location.origin);
    if (url.href === window.location.href && !options.replace) return;
    if (options.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    this.emit();
  }

  emit() {
    const url = new URL(window.location.href);
    for (const listener of this.listeners) listener(url);
  }
}

export const router = new Router();
