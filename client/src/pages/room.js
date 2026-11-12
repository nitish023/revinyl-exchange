/**
 * The Listening Room (/room, Part 6): your own edition of the paper. A headline about your
 * shelf, a lead paragraph about your money, a tip from the counter, then your shelf, your
 * wanted ads and your ledger. Replaces the old /crate page (which now comes here).
 * Design: the RoomAiry board on the design canvas.
 */
import { gradeByRank } from '../../../shared/index.js';
import { actionButton } from '../components/actionButton.js';
import { cover } from '../components/cover.js';
import { emptyState, errorState, loadingState } from '../components/states.js';
import { tradeActions } from '../components/tradeActions.js';
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { live } from '../lib/live.js';
import { labelColor, releasePath } from '../lib/records.js';
import {
  counterText,
  ledgerRow,
  roomByline,
  roomHeadline,
  roomLead,
  shelfStatus,
  wantedLine,
  wantedNote,
} from '../lib/room.js';
import { session } from '../session.js';

function leadParagraph(room) {
  return h(
    'p',
    { class: 'room-lead drop-cap' },
    roomLead(room).map((part) => (part.bold ? h('b', {}, part.bold) : part.text)),
  );
}

function counterBox(counter) {
  if (!counter) return null;
  return h(
    'aside',
    { class: 'room-counter', 'aria-labelledby': 'counter-title' },
    h('p', { id: 'counter-title', class: 'label' }, 'From the counter'),
    h('p', { class: 'room-counter-text' }, counterText(counter)),
    h('a', { class: 'link-arrow', href: releasePath(counter.release.id) }, 'See the wanted ad →'),
  );
}

/** @param {(message: string) => void} done reload and show a message */
function shelfCard(item, done) {
  const title = `${item.release.title} by ${item.release.artist}`;
  const action =
    item.kind === 'copy' && item.ask
      ? actionButton({
          label: 'Cancel ad',
          run: () => api.cancelOrder(item.ask.orderId),
          done: 'FOR SALE ad cancelled. The copy is back in your crate.',
          onDone: done,
        })
      : item.kind === 'copy' && item.status === 'in_crate'
        ? actionButton({
            label: 'Remove',
            confirm: 'Press again to remove',
            run: () => api.removeCopy(item.copyId),
            done: 'Copy removed from your shelf.',
            onDone: done,
          })
        : null;
  return h(
    'li',
    { class: 'shelf-item' },
    h(
      'a',
      { class: 'record-card', href: releasePath(item.release.id) },
      cover(item.release.thumbUrl, `Cover of ${title}`, {
        size: 'thumb',
        labelColor: labelColor(item.release.id),
      }),
      h(
        'div',
        {},
        h('h3', { class: 'record-title' }, item.release.title),
        h('p', { class: 'record-artist' }, `${item.release.artist} · ${item.condition}`),
        h(
          'p',
          {
            class: `record-status${item.kind === 'incoming' || item.tradeId ? ' record-status--moving' : ''}`,
          },
          shelfStatus(item),
        ),
      ),
    ),
    action,
  );
}

function shelfSection(room, done) {
  return h(
    'section',
    { class: 'room-shelf', 'aria-labelledby': 'shelf-title' },
    h(
      'div',
      { class: 'section-head' },
      h('h2', { id: 'shelf-title' }, 'On your shelf'),
      h('a', { class: 'link-arrow', href: '/room/import' }, 'Bring in your Discogs collection →'),
    ),
    room.shelf.length === 0
      ? emptyState(
          'Nothing on your shelf yet',
          'Bring in your Discogs collection, or add a copy from any pressing’s page.',
        )
      : h(
          'ol',
          { class: 'record-grid shelf-grid' },
          room.shelf.map((item) => shelfCard(item, done)),
        ),
  );
}

function wantedSection(room, done) {
  return h(
    'section',
    { class: 'room-wanted', 'aria-labelledby': 'wanted-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'wanted-title' }, 'Your wanted ads'),
      h('p', {}, room.wanted.length ? `$${room.wallet.held} set aside` : 'Nothing set aside'),
    ),
    room.wanted.length === 0
      ? h(
          'p',
          { class: 'room-none' },
          'No wanted ads running. Run one from any pressing’s page and we’ll hold the money for you.',
        )
      : room.wanted.map((ad) =>
          h(
            'div',
            { class: 'room-ad' },
            h(
              'p',
              {},
              h('b', { class: 'ad-lead' }, 'WANTED. '),
              h('a', { href: releasePath(ad.release.id) }, wantedLine(ad)),
              ad.note ? h('i', {}, ` “${ad.note}”`) : null,
            ),
            h(
              'div',
              { class: 'room-ad-foot' },
              h('span', {}, wantedNote(ad)),
              actionButton({
                label: 'Cancel',
                run: () => api.cancelOrder(ad.orderId),
                done: `Wanted ad cancelled. $${ad.price} is back in your spendable cash.`,
                onDone: done,
              }),
            ),
          ),
        ),
  );
}

function ledgerSection(room, done) {
  return h(
    'section',
    { class: 'room-ledger', 'aria-labelledby': 'ledger-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'ledger-title' }, 'Your ledger'),
      h('p', {}, 'Every trade, newest first'),
    ),
    room.ledger.length === 0
      ? h('p', { class: 'room-none' }, 'No trades yet. Your first one will be written down here.')
      : h(
          'table',
          { class: 'ledger-table' },
          h('caption', { class: 'visually-hidden' }, 'Your trades, newest first'),
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ['Date', 'Record', 'Grade', 'Amount', 'Status'].map((name) =>
                h('th', { scope: 'col' }, name),
              ),
            ),
          ),
          h(
            'tbody',
            {},
            room.ledger.map((trade) => {
              const row = ledgerRow(trade);
              return h(
                'tr',
                { class: row.pending ? 'ledger-open' : null },
                h('td', {}, row.date),
                h(
                  'td',
                  {},
                  h('a', { href: releasePath(trade.release.id) }, trade.release.title),
                  h('span', { class: 'ledger-side' }, row.side),
                ),
                h('td', {}, gradeByRank(trade.grade)?.code ?? ''),
                h('td', { class: 'ledger-amount' }, row.amount),
                h('td', {}, h('span', {}, row.status), tradeActions({ trade, onDone: done })),
              );
            }),
          ),
        ),
  );
}

function roomView(room, flash, done) {
  document.title = 'Your Listening Room | reVINYL';
  return [
    h(
      'header',
      { class: 'page-head room-head' },
      h('p', { class: 'kicker' }, 'Your Listening Room'),
      h('h1', { class: 'headline' }, roomHeadline(room)),
      h('p', { class: 'byline' }, roomByline(room)),
    ),
    flash,
    h('div', { class: 'room-top' }, leadParagraph(room), counterBox(room.counter)),
    shelfSection(room, done),
    h('div', { class: 'room-columns' }, wantedSection(room, done), ledgerSection(room, done)),
  ];
}

/** @type {import('./page.js').Page} */
export const roomPage = (ctx) => {
  document.title = 'Your Listening Room | reVINYL';
  const root = h('main', { class: 'page room-page' });
  if (!session.user) {
    replaceChildren(
      root,
      h(
        'div',
        { class: 'state state-empty' },
        h('p', { class: 'state-title' }, 'Your Listening Room is behind the counter.'),
        h(
          'p',
          { class: 'state-hint' },
          h('a', { href: '/login?next=%2Froom' }, 'Log in'),
          ' to see your records, your wanted ads and your money.',
        ),
      ),
    );
    return root;
  }

  const flash = h('p', { class: 'coupon-flash', role: 'status' });
  replaceChildren(root, loadingState('Setting out your records…'));

  async function load() {
    try {
      const { room } = await api.room(ctx.signal);
      if (ctx.signal.aborted) return;
      replaceChildren(root, ...roomView(room, flash, done));
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) return;
      replaceChildren(
        root,
        errorState(errorsFromUnknown(error).message ?? 'We couldn’t open your room.', () => {
          replaceChildren(root, loadingState('Setting out your records…'));
          void load();
        }),
      );
    }
  }

  function done(message) {
    flash.textContent = message;
    void load();
  }

  // A trade or order of yours changed somewhere else (another tab, a buyer): catch up.
  const stop = live.onPrivate(() => void load());
  ctx.signal.addEventListener('abort', stop, { once: true });

  void load();
  return root;
};
