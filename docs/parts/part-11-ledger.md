# Part 11 (Sauransh): the double-entry ledger

**Goal:** every dollar that moves is written down twice, as it is in a real bank's books, so money can be shown never
to be made or lost, every balance can be rebuilt from history, and every trader gets a statement.

## How it works

A **journal** is one movement of money: two or more **entries** whose signed amounts add up to exactly zero. Each entry
is in one **account**:

| Account  | Whose     | Its balance is                                               |
| -------- | --------- | ------------------------------------------------------------ |
| `cash`   | a trader  | the money they have (`users.cash_cents` is a cached copy)    |
| `escrow` | reVINYL's | buyers' payments for trades that haven't settled             |
| `fees`   | reVINYL's | fees taken from sellers' payouts (`trades.seller_fee_cents`) |
| `issued` | reVINYL's | minus all the play money ever handed out                     |

| Journal         | Entries                                               | Posted by                       |
| --------------- | ----------------------------------------------------- | ------------------------------- |
| `signup_grant`  | cash(user) +$2,000, issued −$2,000                    | a database trigger on new users |
| `trade_payment` | cash(buyer) −price, escrow +price                     | `recordTrade` (orderService)    |
| `trade_payout`  | escrow −price, cash(seller) +(price − fee), fees +fee | `received` (tradeService)       |
| `trade_refund`  | escrow −price, cash(buyer) +price                     | `cancel` and `refund`           |
| `adjustment`    | anything that balances, with a memo                   | corrections (and tests)         |

A WANTED ad's hold is not a movement of money (it's a reservation, like a card authorization), so it isn't posted:
`held_cents` stays on `users`, and the `holds` rule checks it against the open bids.

## As built

- **Migration 008**: `ledger_journals`, `ledger_entries`, `trades.seller_fee_cents` (0 until fees arrive).
  - A **deferred constraint trigger** refuses, at COMMIT, any journal whose entries don't add up to zero.
  - **Append-only**: triggers refuse UPDATE and DELETE on both tables. A mistake is fixed with a new journal.
  - Unique indexes: a trade is paid for once and settled (paid out or refunded) at most once.
  - Creating a user posts their grant (trigger), however they're created: sign up, the seed, tests.
  - **Backfill**: grants for existing users, then each existing trade's payment and payout or refund at the time it
    happened. If a wallet still differed from its history, an `adjustment` "opening correction" records the
    difference, so the books start exact and say so. On the seeded dev database none was needed.
- **`server/src/ledger/ledger.js`**: `postJournal(client, journal)` is the only way money moves. It checks the journal
  (`assertBalanced`: whole non-zero cents, sums to zero, cash entries name a user and only they do, trade journals
  name their trade), inserts it, and updates each touched user's cached cash in id order. `tradeJournals.payment`,
  `.payout` and `.refund` build a trade's journals from its row, so both services agree on who gets what.
- **The exchange rules** (`exchangeRules.js`) gained `ledgerBalanced`, `cashMatchesLedger`, `escrowMatchesTrades`,
  `feesMatchTrades` and `tradeJournals` (each trade has one payment, and a payout or refund that matches its status,
  person and amount). `money` is now "everything issued is in wallets, escrow or fees".
- **API**: `GET /api/wallet/statement?before=` (your cash entries, newest first, with the running balance after each;
  50 a page, `more` says if there are older ones) and `GET /api/books` (public: issued, in wallets, in escrow, fees).
- **Listening Room**: "Your statement", a bank-style table with signed amounts and the balance after each line,
  "Earlier lines" to page back, and reVINYL's books underneath.
- **Tests**: `ledger.test.js` (the journals and every way `assertBalanced` refuses one), `ledger.int.test.js` (what
  each step posts, the statement and its paging, the books, and what the database refuses: an unbalanced journal, an
  edit or delete, paying or settling twice, a wallet going below its held cash), `statement.test.js` (the section).
  Every market test ends with the rules, which now include the ledger's.
