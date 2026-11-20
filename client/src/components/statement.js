/**
 * "Your statement" in the Listening Room: every movement of your cash from the double-entry
 * ledger, newest first, with the balance after each, like a bank statement. Under it,
 * reVINYL's own books, which anyone can check add up. Spec: docs/parts/part-11-ledger.md.
 */
import { h, replaceChildren } from '../dom.js';
import { api, isAbortError } from '../lib/api.js';
import { errorsFromUnknown } from '../lib/forms.js';
import { releasePath } from '../lib/records.js';

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

/** "+$40.00" or "−$40.00" (a real minus sign, so the column lines up and reads as money). */
export function signedAmount(amount) {
  return amount.startsWith('-') ? `−$${amount.slice(1)}` : `+$${amount}`;
}

function statementRow(line) {
  return h(
    'tr',
    {},
    h('td', {}, DAY.format(new Date(line.at))),
    h(
      'td',
      {},
      line.releaseId
        ? h('a', { href: releasePath(line.releaseId) }, line.description)
        : line.description,
    ),
    h('td', { class: 'ledger-amount' }, signedAmount(line.amount)),
    h('td', { class: 'ledger-amount' }, `$${line.balance}`),
  );
}

/** The four balances of reVINYL's books in one sentence. They always add up. */
export function booksSentence(books) {
  return (
    `reVINYL’s books: $${books.issued} of play money issued, $${books.inWallets} in traders’ ` +
    `wallets, $${books.inEscrow} held in escrow for trades on their way, and $${books.fees} in fees.`
  );
}

/**
 * @param {{ signal: AbortSignal }} options the page's signal: loading stops when you leave
 * @returns {HTMLElement}
 */
export function statementSection({ signal }) {
  const body = h('tbody');
  const status = h('p', { class: 'room-none', role: 'status' }, 'Opening the ledger…');
  const more = h('button', { class: 'button', type: 'button', hidden: true }, 'Earlier lines');
  const books = h('p', { class: 'statement-books' });
  let oldest = null;

  async function loadPage() {
    more.disabled = true;
    try {
      const page = await api.statement(oldest ?? undefined, signal);
      if (signal.aborted) return;
      body.append(...page.lines.map(statementRow));
      oldest = page.lines.at(-1)?.journalId ?? oldest;
      status.textContent = body.children.length ? '' : 'Nothing has moved yet.';
      more.hidden = !page.more;
    } catch (error) {
      if (isAbortError(error) || signal.aborted) return;
      status.textContent = errorsFromUnknown(error).message ?? 'We couldn’t open your statement.';
    } finally {
      more.disabled = false;
    }
  }

  async function loadBooks() {
    try {
      const { books: house } = await api.books(signal);
      if (!signal.aborted) replaceChildren(books, booksSentence(house));
    } catch {
      // The house books are a footnote: the statement stands without them.
    }
  }

  more.addEventListener('click', () => void loadPage());
  void loadPage();
  void loadBooks();

  return h(
    'section',
    { class: 'room-statement', 'aria-labelledby': 'statement-title' },
    h(
      'div',
      { class: 'section-head section-head--small' },
      h('h2', { id: 'statement-title' }, 'Your statement'),
      h('p', {}, 'Every dollar in and out, from the ledger'),
    ),
    h(
      'table',
      { class: 'ledger-table statement-table' },
      h(
        'caption',
        { class: 'visually-hidden' },
        'Your cash, newest first, with the balance after each line',
      ),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['Date', 'What', 'Amount', 'Balance'].map((name) => h('th', { scope: 'col' }, name)),
        ),
      ),
      body,
    ),
    status,
    more,
    books,
  );
}
