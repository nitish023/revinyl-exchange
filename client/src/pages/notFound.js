import { h } from '../dom.js';

export const notFoundPage = () => {
  document.title = 'Page not found | reVINYL';
  return h(
    'main',
    { class: 'page not-found' },
    h('p', { class: 'banner', 'aria-hidden': 'true' }, '404'),
    h('h1', { class: 'headline' }, 'This side is blank.'),
    h('p', { class: 'deck' }, 'The page you’re looking for isn’t in this issue.'),
    h('a', { href: '/', class: 'button' }, 'Back to the front page'),
  );
};
