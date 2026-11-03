/**
 * A tiny helper for building DOM without a framework.
 *
 *   h('a', { href: '/search', class: 'nav-link' }, 'Search')
 *
 * Children that are strings become text nodes, so data from Discogs or other
 * users is never parsed as HTML. There is deliberately no innerHTML here.
 */

export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (value === true) {
      element.setAttribute(name, '');
    } else {
      element.setAttribute(name, String(value));
    }
  }
  append(element, children);
  return element;
}

export function append(parent, children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace everything inside `parent`. */
export function replaceChildren(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
}
