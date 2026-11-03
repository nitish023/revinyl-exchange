// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { h, replaceChildren } from './dom.js';
import { nextPath } from './pages/auth.js';

describe('h()', () => {
  it('treats strings as text, never HTML (Discogs data is user-contributed)', () => {
    const element = h('p', {}, '<img src=x onerror=alert(1)>');
    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(element.querySelector('img')).toBeNull();
  });

  it('sets attributes, skips empty ones, and wires event handlers', () => {
    const onClick = vi.fn();
    const button = h(
      'button',
      { type: 'button', disabled: true, title: null, onclick: onClick },
      'Go',
    );
    expect(button.getAttribute('type')).toBe('button');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.hasAttribute('title')).toBe(false);
    button.disabled = false;
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('flattens child arrays and drops null/false children', () => {
    const list = h('ul', {}, [h('li', {}, 'a'), null, false, h('li', {}, 'b')], 3);
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toBe('ab3');
    replaceChildren(list, 'empty');
    expect(list.textContent).toBe('empty');
  });
});

describe('nextPath', () => {
  it('only follows same-site paths after login', () => {
    expect(nextPath(new URLSearchParams('next=/release/1'))).toBe('/release/1');
    expect(nextPath(new URLSearchParams('next=//evil.example'))).toBe('/search');
    expect(nextPath(new URLSearchParams('next=https://evil.example'))).toBe('/search');
    expect(nextPath(new URLSearchParams(''))).toBe('/search');
  });
});
