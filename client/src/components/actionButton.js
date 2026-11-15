/**
 * A small button that does one thing to your own records or ads (Remove, Cancel), shows
 * what went wrong next to itself, and reports success. Taken from the old Your Crate page
 * (Part 3) so the Listening Room can use it.
 *
 * With `confirm`, the first press only changes the label to that text (for things that
 * can't be undone) and the second press does it.
 */
import { h } from '../dom.js';
import { ApiError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';

/**
 * @param {{ label: string, run: () => Promise<unknown>, done: string, confirm?: string,
 *   onDone: (message: string) => void }} options
 *   onDone gets `done` on success, or the server's message when something changed first (409)
 * @returns {HTMLElement}
 */
export function actionButton({ label, run, done, confirm, onDone }) {
  const button = h('button', { class: 'button button--quiet', type: 'button' }, label);
  const error = h('span', { class: 'field-error', role: 'alert' });
  let armed = !confirm;
  button.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      button.textContent = confirm;
      return;
    }
    button.disabled = true;
    error.textContent = '';
    try {
      await run();
      onDone(done);
    } catch (failure) {
      // 409: it changed first (the ad filled, the copy went into a trade). Reload and say so.
      if (failure instanceof ApiError && failure.status === 409) {
        onDone(failure.message);
        return;
      }
      error.textContent = errorsFromUnknown(failure).message ?? 'That didn’t work. Try again.';
      button.disabled = false;
    }
  });
  return h('span', { class: 'action-button' }, button, error);
}
