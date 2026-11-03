import { SEARCH_QUERY_MAX } from '../../../shared/index.js';
import { h } from '../dom.js';

let nextId = 0;

/** The big "LOOKING FOR ____ [SEARCH]" field used on the front page and the search page. */
export function searchBox(options) {
  const id = `search-${(nextId += 1)}`;
  const input = h('input', {
    id,
    type: 'search',
    name: 'q',
    class: 'search-input',
    placeholder: 'an artist, album or catalog no.',
    maxlength: SEARCH_QUERY_MAX,
    autocomplete: 'off',
    spellcheck: 'false',
    autofocus: options.autofocus ?? false,
  });
  input.value = options.value;
  if (options.onInput) input.addEventListener('input', () => options.onInput(input.value));
  const form = h(
    'form',
    { class: 'search-form', role: 'search' },
    h('label', { for: id, class: 'label' }, 'Looking for'),
    input,
    h('button', { class: 'button', type: 'submit' }, 'Search'),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    options.onSubmit(input.value.trim());
  });
  return form;
}
