/**
 * Shared login/register form. Validates with the same Zod schema the server
 * uses, so the messages match, and shows server errors next to the right field.
 */

import { fieldErrors } from '../../../shared/index.js';
import { h } from '../dom.js';
import { errorsFromUnknown } from '../lib/forms.js';

export function authForm(options) {
  const inputs = new Map();
  const feedback = new Map();
  const banner = h('div', { class: 'form-banner', role: 'alert', hidden: true });
  const submit = h(
    'button',
    { class: 'button button--block', type: 'submit' },
    options.submitLabel,
  );

  const rows = options.fields.map((field) => {
    const id = `field-${field.name}`;
    const input = h('input', {
      id,
      name: field.name,
      type: field.type ?? 'text',
      class: 'input',
      autocomplete: field.autocomplete,
      'aria-describedby': `${id}-feedback`,
    });
    const message = h('div', { id: `${id}-feedback`, class: 'field-error' });
    inputs.set(field.name, input);
    feedback.set(field.name, message);
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id, class: 'label' }, field.label),
      input,
      field.hint ? h('div', { class: 'field-hint' }, field.hint) : null,
      message,
    );
  });

  function showErrors(fields, message) {
    for (const [name, input] of inputs) {
      const error = fields[name];
      if (error) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
      feedback.get(name).textContent = error ?? '';
    }
    banner.hidden = !message;
    banner.textContent = message ?? '';
  }

  const form = h('form', { novalidate: true }, banner, ...rows, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries([...inputs].map(([name, input]) => [name, input.value]));
    const parsed = options.schema.safeParse(raw);
    if (!parsed.success) {
      showErrors(fieldErrors(parsed.error), null);
      return;
    }
    showErrors({}, null);
    submit.disabled = true;
    try {
      await options.onSubmit(parsed.data);
    } catch (error) {
      const errors = errorsFromUnknown(error);
      showErrors(errors.fields, errors.message);
    } finally {
      submit.disabled = false;
    }
  });
  return form;
}
