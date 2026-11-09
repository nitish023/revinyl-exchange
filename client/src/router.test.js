import { describe, expect, it } from 'vitest';
import { matchRoute, shouldIntercept } from './router.js';

describe('matchRoute', () => {
  it('matches every page', () => {
    expect(matchRoute('/')).toEqual({ name: 'home', params: {} });
    expect(matchRoute('/search')).toEqual({ name: 'search', params: {} });
    expect(matchRoute('/release/249504')).toEqual({ name: 'release', params: { id: '249504' } });
    expect(matchRoute('/release/249504/')).toEqual({ name: 'release', params: { id: '249504' } });
    expect(matchRoute('/login').name).toBe('login');
    expect(matchRoute('/register').name).toBe('register');
    expect(matchRoute('/crate').name).toBe('crate');
    expect(matchRoute('/crate/').name).toBe('crate');
  });

  it('sends anything else to the 404 page', () => {
    expect(matchRoute('/release/abc').name).toBe('notFound');
    expect(matchRoute('/release/').name).toBe('notFound');
    expect(matchRoute('/admin').name).toBe('notFound');
  });
});

describe('shouldIntercept', () => {
  const origin = 'https://revinyl.test';
  const click = (overrides = {}) => ({
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  });
  const link = (href, attrs = {}) => ({
    href,
    target: attrs.target ?? '',
    hasAttribute: (name) => name === 'download' && Boolean(attrs.download),
  });

  it('handles plain clicks on our own pages', () => {
    expect(shouldIntercept(click(), link(`${origin}/release/1`), origin)).toBe(true);
  });

  it('lets the browser handle new tabs, other sites, downloads and API links', () => {
    expect(shouldIntercept(click({ metaKey: true }), link(`${origin}/search`), origin)).toBe(false);
    expect(shouldIntercept(click({ button: 1 }), link(`${origin}/search`), origin)).toBe(false);
    expect(shouldIntercept(click(), link('https://www.discogs.com/release/1'), origin)).toBe(false);
    expect(shouldIntercept(click(), link(`${origin}/search`, { target: '_blank' }), origin)).toBe(
      false,
    );
    expect(shouldIntercept(click(), link(`${origin}/file`, { download: true }), origin)).toBe(
      false,
    );
    expect(shouldIntercept(click(), link(`${origin}/api/health`), origin)).toBe(false);
  });
});
