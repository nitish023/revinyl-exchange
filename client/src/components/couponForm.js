/**
 * A form printed as a clip-out coupon (.coupon). It checks the values with the same Zod
 * schema the server uses, so the browser and the server give the same messages, and shows
 * server errors next to the right field. Used by the ad forms on the pressing page.
 */
import { fieldErrors } from '../../../shared/index.js';
import { h } from '../dom.js';
import { errorsFromUnknown } from '../lib/forms.js';

/**
 * @typedef {object} CouponField
 * @property {string} name the key the schema and the server use for this field
 * @property {string} label
 * @property {HTMLElement} control an input, select, textarea or fieldset
 * @property {string} [hint]
 * @property {boolean} [group] a fieldset of radios or checkboxes, labelled by a legend
 */

/**
 * @param {{
 *   id: string,
 *   title: string,
 *   intro?: string,
 *   fields: CouponField[],
 *   submitLabel: string,
 *   footnote?: HTMLElement,
 *   schema?: import('zod').ZodType,
 *   collect: () => object,
 *   onSubmit: (values: object) => Promise<string | void>,
 * }} options onSubmit returns a line to show after it worked, like "Listed."
 */
export function couponForm(options) {
  const feedback = new Map();
  const banner = h('div', { class: 'form-banner', role: 'alert', hidden: true });
  const done = h('p', { class: 'coupon-done', role: 'status' });
  const submit = h(
    'button',
    { class: 'button button--block', type: 'submit' },
    options.submitLabel,
  );

  const rows = options.fields.map((field) => {
    const id = `${options.id}-${field.name}`;
    const message = h('div', { id: `${id}-feedback`, class: 'field-error' });
    feedback.set(field.name, { message, control: field.control });
    field.control.setAttribute('aria-describedby', `${id}-feedback`);
    if (field.group) {
      return h(
        'fieldset',
        { class: 'field choice-field' },
        h('legend', { class: 'label' }, field.label),
        field.control,
        field.hint ? h('div', { class: 'field-hint' }, field.hint) : null,
        message,
      );
    }
    field.control.id = id;
    return h(
      'div',
      { class: 'field' },
      h('label', { for: id, class: 'label' }, field.label),
      field.control,
      field.hint ? h('div', { class: 'field-hint' }, field.hint) : null,
      message,
    );
  });

  /** Messages for fields this form doesn't show (or none) go in the banner at the top. */
  function showErrors(fields, message) {
    const leftover = [];
    for (const [name, error] of Object.entries(fields)) {
      if (!feedback.has(name)) leftover.push(error);
    }
    for (const [name, { message: line, control }] of feedback) {
      if (fields[name]) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
      line.textContent = fields[name] ?? '';
    }
    const text = message ?? (leftover.length ? leftover.join(' ') : null);
    banner.hidden = !text;
    banner.textContent = text ?? '';
  }

  const form = h(
    'form',
    { class: 'coupon ad-coupon', novalidate: true, 'aria-labelledby': `${options.id}-title` },
    h('h3', { id: `${options.id}-title`, class: 'coupon-title' }, options.title),
    options.intro ? h('p', { class: 'coupon-intro' }, options.intro) : null,
    banner,
    ...rows,
    submit,
    options.footnote ?? null,
    done,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    done.textContent = '';
    const values = options.collect();
    if (options.schema) {
      const parsed = options.schema.safeParse(values);
      if (!parsed.success) {
        showErrors(fieldErrors(parsed.error), null);
        return;
      }
    }
    showErrors({}, null);
    submit.disabled = true;
    try {
      const message = await options.onSubmit(values);
      if (message) done.textContent = message;
    } catch (error) {
      const errors = errorsFromUnknown(error);
      showErrors(errors.fields, errors.message);
    } finally {
      submit.disabled = false;
    }
  });

  return { element: form, showErrors };
}
