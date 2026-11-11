/**
 * Bring in your Discogs collection (/room/import, Part 6). Three steps on one page:
 *   1. type your Discogs username (your collection must be public on Discogs)
 *   2. check the list: the vinyl in your collection, newest first, with grades filled in
 *      from Discogs where you set them; pick the rest and untick what you don't want
 *   3. bring them in; they land on your shelf in the Listening Room
 */
import {
  collectionImportSchema,
  discogsUsernameSchema,
  fieldErrors,
  GRADES,
} from '../../../shared/index.js';
import { cover } from '../components/cover.js';
import { loadingState } from '../components/states.js';
import { h, replaceChildren } from '../dom.js';
import { api } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { labelColor } from '../lib/records.js';
import { session } from '../session.js';

const BEST_FIRST_GRADES = [...GRADES].reverse();

/** A <select> of grades. `value` is a rank, 'generic' (sleeves) or null (not chosen). */
function gradeSelect({ label, value, sleeve }) {
  const select = h(
    'select',
    { class: 'input input--compact', 'aria-label': label },
    h('option', { value: '' }, 'Grade…'),
    sleeve ? h('option', { value: 'generic' }, 'Generic sleeve') : null,
    BEST_FIRST_GRADES.map((grade) => h('option', { value: String(grade.rank) }, grade.code)),
  );
  select.value = value === null || value === undefined ? '' : String(value);
  return select;
}

/** What the select says, in the shape the import takes: a rank, null (generic), or undefined. */
function readGrade(select) {
  if (select.value === '') return undefined;
  if (select.value === 'generic') return null;
  return Number(select.value);
}

function describe(release) {
  return [
    release.year,
    release.label && release.catno ? `${release.label} ${release.catno}` : release.label,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** @type {import('./page.js').Page} */
export const roomImportPage = (ctx) => {
  document.title = 'Bring in your Discogs collection | reVINYL';
  const root = h('main', { class: 'page import-page' });
  const head = h(
    'header',
    { class: 'page-head' },
    h('p', { class: 'kicker' }, 'Your Listening Room'),
    h('h1', { class: 'headline' }, 'Bring In Your Discogs Collection'),
    h(
      'p',
      { class: 'deck' },
      'Up to 100 records at a time. You choose the grades; Discogs fills in any you’ve already set.',
    ),
  );
  if (!session.user) {
    replaceChildren(
      root,
      head,
      h(
        'p',
        { class: 'state state-empty' },
        h('a', { href: '/login?next=%2Froom%2Fimport' }, 'Log in'),
        ' to bring your records in.',
      ),
    );
    return root;
  }

  const username = h('input', {
    id: 'discogs-username',
    class: 'input',
    autocomplete: 'off',
    autocapitalize: 'none',
    spellcheck: 'false',
    placeholder: 'your-discogs-name',
    'aria-describedby': 'discogs-username-error',
  });
  const usernameError = h('div', { id: 'discogs-username-error', class: 'field-error' });
  const lookUp = h('button', { class: 'button', type: 'submit' }, 'Look up my collection');
  const lookupForm = h(
    'form',
    { class: 'coupon import-lookup', novalidate: true },
    h('h2', { class: 'coupon-title' }, 'Step one: your Discogs name'),
    h(
      'p',
      { class: 'coupon-intro' },
      'We read your collection the way any visitor to Discogs can, so it has to be public (Discogs → Settings → Privacy). We never see your Discogs password.',
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'label', for: 'discogs-username' }, 'Discogs username'),
      username,
      usernameError,
    ),
    lookUp,
  );
  const results = h('div', { class: 'import-results', 'aria-live': 'polite' });
  replaceChildren(root, head, lookupForm, results);

  lookupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const parsed = discogsUsernameSchema.safeParse(username.value);
    if (!parsed.success) {
      usernameError.textContent = parsed.error.issues[0].message;
      username.setAttribute('aria-invalid', 'true');
      return;
    }
    usernameError.textContent = '';
    username.removeAttribute('aria-invalid');
    lookUp.disabled = true;
    replaceChildren(results, loadingState('Flipping through your collection on Discogs…'));
    try {
      const preview = await api.collectionPreview(parsed.data, ctx.signal);
      if (!ctx.signal.aborted) replaceChildren(results, previewView(preview));
    } catch (error) {
      if (ctx.signal.aborted) return;
      const { fields, message } = errorsFromUnknown(error);
      usernameError.textContent = fields.username ?? message ?? 'That didn’t work. Try again.';
      username.setAttribute('aria-invalid', 'true');
      replaceChildren(results);
    } finally {
      lookUp.disabled = false;
    }
  });

  function previewView(preview) {
    const importable = preview.items.filter((item) => !item.alreadyImported);
    const rows = preview.items.map((item) => {
      const tick = h('input', {
        type: 'checkbox',
        checked: !item.alreadyImported,
        disabled: item.alreadyImported,
        'aria-label': `Bring in ${item.release.title}`,
      });
      const grade = gradeSelect({
        label: `Record grade for ${item.release.title}`,
        value: item.grade,
      });
      const sleeve = gradeSelect({
        label: `Sleeve grade for ${item.release.title}`,
        value: item.sleeveGrade,
        sleeve: true,
      });
      if (item.alreadyImported) {
        grade.disabled = true;
        sleeve.disabled = true;
      }
      const error = h('span', { class: 'field-error', role: 'alert' });
      const element = h(
        'li',
        { class: `import-row${item.alreadyImported ? ' import-row--done' : ''}` },
        h('label', { class: 'import-tick' }, tick),
        cover(item.release.thumbUrl, `Cover of ${item.release.title}`, {
          size: 'thumb',
          labelColor: labelColor(item.release.id),
        }),
        h(
          'div',
          { class: 'import-text' },
          h('p', { class: 'record-title' }, item.release.title),
          h('p', { class: 'record-artist' }, item.release.artist),
          h('p', { class: 'record-meta' }, describe(item.release)),
          item.alreadyImported ? h('p', { class: 'label' }, 'Already on your shelf') : null,
        ),
        h(
          'div',
          { class: 'import-grades' },
          h('span', { class: 'label' }, 'Record'),
          grade,
          h('span', { class: 'label' }, 'Sleeve'),
          sleeve,
          error,
        ),
      );
      return { item, tick, grade, sleeve, error, element };
    });

    const count = h('span', { class: 'import-count' });
    const banner = h('div', { class: 'form-banner', role: 'alert', hidden: true });
    const submit = h('button', { class: 'button', type: 'submit' }, 'Bring them in');
    const updateCount = () => {
      const ticked = rows.filter((row) => row.tick.checked && !row.tick.disabled).length;
      count.textContent = `${ticked} of ${importable.length} ticked`;
      submit.disabled = ticked === 0;
    };
    for (const row of rows) row.tick.addEventListener('change', updateCount);
    const setAll = (checked) => {
      for (const row of rows) if (!row.tick.disabled) row.tick.checked = checked;
      updateCount();
    };
    updateCount();

    const form = h(
      'form',
      { class: 'import-preview', novalidate: true },
      h(
        'div',
        { class: 'section-head' },
        h('h2', {}, 'Step two: check the grades'),
        h('p', {}, `${preview.username} on Discogs`),
      ),
      h(
        'p',
        { class: 'import-summary' },
        preview.items.length === 0
          ? 'We didn’t find any vinyl in that collection.'
          : `${preview.items.length} vinyl records, newest first.`,
        preview.skipped ? ` We left out ${preview.skipped} that aren’t vinyl.` : '',
        preview.more
          ? ' Your collection has more; bring these in, then come back for the rest.'
          : '',
        ` Your crate has room for ${preview.crateRoom} more.`,
      ),
      importable.length
        ? h(
            'p',
            { class: 'import-bulk' },
            h(
              'button',
              { class: 'button button--quiet', type: 'button', onclick: () => setAll(true) },
              'Tick all',
            ),
            h(
              'button',
              { class: 'button button--quiet', type: 'button', onclick: () => setAll(false) },
              'Untick all',
            ),
            count,
          )
        : null,
      banner,
      h(
        'ol',
        { class: 'import-list' },
        rows.map((row) => row.element),
      ),
      importable.length ? h('div', { class: 'import-submit' }, submit) : null,
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      banner.hidden = true;
      const chosen = rows.filter((row) => row.tick.checked && !row.tick.disabled);
      let missing = 0;
      for (const row of rows) {
        const needsGrade = chosen.includes(row) && readGrade(row.grade) === undefined;
        row.error.textContent = needsGrade ? 'Pick a grade' : '';
        if (needsGrade) row.grade.setAttribute('aria-invalid', 'true');
        else row.grade.removeAttribute('aria-invalid');
        if (needsGrade) missing += 1;
      }
      const body = {
        username: preview.username,
        items: chosen.map((row) => ({
          instanceId: row.item.instanceId,
          grade: readGrade(row.grade),
          // An ungraded sleeve is treated like a generic one.
          sleeveGrade: readGrade(row.sleeve) ?? null,
        })),
      };
      const parsed = collectionImportSchema.safeParse(body);
      if (missing || !parsed.success) {
        banner.hidden = false;
        banner.textContent = missing
          ? `Pick a record grade for ${missing === 1 ? 'one record' : `${missing} records`}, or untick ${missing === 1 ? 'it' : 'them'}.`
          : Object.values(fieldErrors(parsed.error))[0];
        return;
      }
      submit.disabled = true;
      try {
        const result = await api.importCollection(parsed.data);
        replaceChildren(
          results,
          h(
            'div',
            { class: 'state import-done' },
            h(
              'p',
              { class: 'state-title' },
              result.imported === 1
                ? 'One record is on your shelf.'
                : `${result.imported} records are on your shelf.`,
            ),
            result.alreadyImported
              ? h('p', { class: 'state-hint' }, `${result.alreadyImported} were already there.`)
              : null,
            h('a', { class: 'button', href: '/room' }, 'Go to your Listening Room'),
          ),
        );
      } catch (error) {
        const { message, fields } = errorsFromUnknown(error);
        banner.hidden = false;
        banner.textContent = message ?? Object.values(fields)[0] ?? 'That didn’t work. Try again.';
        submit.disabled = false;
      }
    });
    return form;
  }

  return root;
};
