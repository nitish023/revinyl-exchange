/**
 * The three ad forms on a pressing page (Part 3): add a copy to your crate, sell one of
 * your copies, and run a WANTED ad. adCoupons.js puts them together; each form reports a
 * finished action with onDone(message) so the message survives the coupons redrawing.
 */
import {
  addCopySchema,
  CONDITION_FLAGS,
  formatCents,
  gradeByRank,
  GRADES,
  isPhotoType,
  MAX_HEADLINE_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_ORDER_NOTE_LENGTH,
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_COPY,
  parseDollars,
  PHOTO_TYPES,
  placeOrderSchema,
} from '../../../shared/index.js';
import { h } from '../dom.js';
import { api, ApiError } from '../lib/api.js';
import { couponForm } from './couponForm.js';

/** Mint first: that's how the grade scale reads in record shops. */
const BEST_FIRST = [...GRADES].reverse();
const GENERIC_SLEEVE = 'generic';

/** A select's value as a grade rank, or undefined when nothing is picked yet. */
const rankOf = (value) => (value === '' ? undefined : Number(value));
const idOf = (value) => (value === '' ? undefined : Number(value));

function gradeOptions() {
  return BEST_FIRST.map((grade) =>
    h('option', { value: String(grade.rank) }, `${grade.code} · ${grade.label}`),
  );
}

/** "NM or better", with the two ends of the scale said plainly. */
export function minGradeText(rank) {
  if (rank === GRADES.at(-1).rank) return 'Mint only';
  if (rank === GRADES[0].rank) return 'Any grade';
  return `${gradeByRank(rank).code} or better`;
}

const priceInput = () =>
  h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: '40.00',
  });

/** Problems with the chosen photos, checked before anything is sent. */
export function photoProblem(files) {
  if (files.length > MAX_PHOTOS_PER_COPY) return `Choose up to ${MAX_PHOTOS_PER_COPY} photos.`;
  const wrongType = files.find((file) => !isPhotoType(file.type));
  if (wrongType) return `${wrongType.name} isn’t a JPEG, PNG or WebP image.`;
  const tooBig = files.find((file) => file.size > MAX_PHOTO_BYTES);
  if (tooBig) return `${tooBig.name} is over ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`;
  return null;
}

/**
 * "Add a copy to your crate": grade, sleeve, condition flags, headline, notes, photos.
 * @param {{ release: { id: number }, onDone: (message: string) => Promise<void> }} options
 */
export function addCopyForm({ release, onDone }) {
  const grade = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, 'Choose…'),
    gradeOptions(),
  );
  const sleeve = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, 'Choose…'),
    h('option', { value: GENERIC_SLEEVE }, 'Generic or no sleeve'),
    gradeOptions(),
  );
  const flagBoxes = CONDITION_FLAGS.map((flag) => ({
    code: flag.code,
    box: h('input', { type: 'checkbox', value: flag.code }),
    label: flag.label,
  }));
  const flags = h(
    'div',
    { class: 'choice-list' },
    flagBoxes.map(({ box, label }) => h('label', { class: 'choice' }, box, h('span', {}, label))),
  );
  const headline = h('input', {
    class: 'input',
    type: 'text',
    maxlength: MAX_HEADLINE_LENGTH,
    placeholder: 'Played twice.',
  });
  const notes = h('textarea', { class: 'input', rows: 3, maxlength: MAX_NOTES_LENGTH });
  const photos = h('input', {
    class: 'input input--file',
    type: 'file',
    accept: PHOTO_TYPES.join(','),
    multiple: true,
  });

  const form = couponForm({
    id: 'add-copy',
    title: 'Add a copy to your crate',
    intro: 'Grade the record itself; the sleeve is graded on its own.',
    submitLabel: 'Add to my crate',
    schema: addCopySchema,
    fields: [
      { name: 'grade', label: 'Record grade', control: grade },
      { name: 'sleeveGrade', label: 'Sleeve', control: sleeve },
      { name: 'flags', label: 'Anything a buyer should know', control: flags, group: true },
      {
        name: 'headline',
        label: 'Headline',
        control: headline,
        hint: 'The bold first words of your ad.',
      },
      { name: 'notes', label: 'Notes', control: notes, hint: 'How it looks and how it plays.' },
      {
        name: 'photos',
        label: 'Photos',
        control: photos,
        hint: `Up to ${MAX_PHOTOS_PER_COPY} JPEG, PNG or WebP photos, 2 MB each.`,
      },
    ],
    collect: () => ({
      releaseId: release.id,
      grade: rankOf(grade.value),
      sleeveGrade: sleeve.value === GENERIC_SLEEVE ? null : rankOf(sleeve.value),
      flags: flagBoxes.filter(({ box }) => box.checked).map(({ code }) => code),
      headline: headline.value,
      notes: notes.value,
    }),
    onSubmit: async (values) => {
      const files = [...(photos.files ?? [])];
      const problem = photoProblem(files);
      if (problem) throw new ApiError(0, 'BAD_PHOTOS', problem, { photos: problem });
      const { copy } = await api.addCopy(values);
      // The copy exists now; a photo that fails is reported, not a reason to undo it.
      const failed = [];
      for (const file of files) {
        try {
          await api.uploadPhoto(copy.id, file);
        } catch (error) {
          failed.push(`${file.name} (${error instanceof Error ? error.message : 'failed'})`);
        }
      }
      const added = `Added a ${copy.condition} copy to your crate.`;
      await onDone(
        failed.length ? `${added} These photos didn’t upload: ${failed.join(', ')}.` : added,
      );
    },
  });
  return form.element;
}

/**
 * "Sell your copy": one of your copies of this pressing that's in your crate, and a price.
 * @param {{ copies: object[], onDone: (message: string) => Promise<void> }} options
 */
export function sellForm({ copies, onDone }) {
  if (copies.length === 0) {
    return h(
      'div',
      { class: 'coupon ad-coupon' },
      h('h3', { class: 'coupon-title' }, 'Sell your copy'),
      h(
        'p',
        { class: 'coupon-intro' },
        'You have no copies of this pressing in your crate. Add one with the coupon beside this, then set your price here.',
      ),
    );
  }
  const copy = h(
    'select',
    { class: 'input' },
    copies.length > 1 ? h('option', { value: '' }, 'Choose a copy…') : null,
    copies.map((item) =>
      h(
        'option',
        { value: String(item.id) },
        item.headline ? `${item.condition} · ${item.headline}` : item.condition,
      ),
    ),
  );
  const price = priceInput();
  const form = couponForm({
    id: 'sell-copy',
    title: 'Sell your copy',
    intro:
      'If a wanted ad already offers your price or more, it sells straight away at their price.',
    submitLabel: 'Run my FOR SALE ad',
    schema: placeOrderSchema,
    fields: [
      { name: 'copyId', label: 'Copy', control: copy },
      { name: 'price', label: 'Asking price ($)', control: price },
    ],
    collect: () => ({ side: 'ask', copyId: idOf(copy.value), price: price.value }),
    onSubmit: async (values) => {
      const { order, trade } = await api.placeOrder(values);
      await onDone(
        trade
          ? `Sold for $${trade.price}. The buyer’s payment is held until they’ve checked the record.`
          : `Listed for $${order.price}. It stays in the classifieds until it sells or you cancel it.`,
      );
    },
  });
  return form.element;
}

/**
 * "Run your own ad": a WANTED ad with the lowest grade you'll take and the most you'll pay.
 * @param {{ release: { id: number }, wallet: { spendable: string },
 *   onDone: (message: string) => Promise<void> }} options
 */
export function wantedForm({ release, wallet, onDone }) {
  const radios = BEST_FIRST.map((grade) => ({
    rank: grade.rank,
    radio: h('input', {
      type: 'radio',
      name: 'wanted-min-grade',
      value: String(grade.rank),
      // VG+ is what most collectors buy, so it's the starting choice.
      checked: grade.code === 'VG+',
    }),
  }));
  const minGrade = h(
    'div',
    { class: 'choice-list' },
    radios.map(({ rank, radio }) =>
      h('label', { class: 'choice' }, radio, h('span', {}, minGradeText(rank))),
    ),
  );
  const price = priceInput();
  const note = h('textarea', { class: 'input', rows: 2, maxlength: MAX_ORDER_NOTE_LENGTH });
  const holdNote = h('p', { class: 'coupon-footnote' });
  const showHold = () => {
    const cents = parseDollars(price.value);
    holdNote.textContent =
      cents === null
        ? `Your ad holds its full price from the $${wallet.spendable} you have to spend.`
        : `We’ll hold $${formatCents(cents)} of your $${wallet.spendable} while the ad runs.`;
  };
  price.addEventListener('input', showHold);
  showHold();

  const form = couponForm({
    id: 'wanted-ad',
    title: 'Run your own ad',
    intro:
      'Say the lowest grade you’ll take and the most you’ll pay. A copy that good at your price or less is yours, at its price.',
    submitLabel: 'Run my WANTED ad',
    schema: placeOrderSchema,
    fields: [
      { name: 'minGrade', label: 'Lowest grade you’ll take', control: minGrade, group: true },
      { name: 'price', label: 'Most you’ll pay ($)', control: price },
      { name: 'note', label: 'A line for sellers (optional)', control: note },
    ],
    footnote: holdNote,
    collect: () => {
      const picked = radios.find(({ radio }) => radio.checked);
      return {
        side: 'bid',
        releaseId: release.id,
        price: price.value,
        minGrade: picked ? picked.rank : undefined,
        note: note.value,
      };
    },
    onSubmit: async (values) => {
      const { order, trade } = await api.placeOrder(values);
      await onDone(
        trade
          ? `It matched: you bought a ${gradeByRank(trade.grade).code} copy for $${trade.price}. The seller ships it next.`
          : `Your wanted ad is running. $${order.price} is held until it fills or you cancel it.`,
      );
    },
  });
  return form.element;
}
