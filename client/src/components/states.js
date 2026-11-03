import { h } from '../dom.js';

export function loadingState(label) {
  return h(
    'div',
    { class: 'state state-loading', role: 'status' },
    h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', {}, label),
  );
}

export function errorState(message, retry) {
  return h(
    'div',
    { class: 'state state-error', role: 'alert' },
    h('p', { class: 'state-title' }, 'Stop the presses.'),
    h('p', { class: 'state-hint' }, message),
    retry ? h('button', { class: 'button', type: 'button', onclick: retry }, 'Try again') : null,
  );
}

export function emptyState(title, hint) {
  return h(
    'div',
    { class: 'state state-empty' },
    h('p', { class: 'state-title' }, title),
    h('p', { class: 'state-hint' }, hint),
  );
}
