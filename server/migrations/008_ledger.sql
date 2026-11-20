-- The double-entry ledger. Every movement of money is a journal: a few entries that add up
-- to exactly zero, so money is only ever moved between accounts, never made or lost.
--
--   account   whose        balance means
--   cash      a user's     the money they have (users.cash_cents is a cached copy of it)
--   escrow    reVINYL's    buyers' payments for trades that haven't settled yet
--   fees      reVINYL's    fees taken from sellers' payouts
--   issued    reVINYL's    minus all the play money ever handed out
--
-- An entry's amount is signed: positive adds to that account's balance, negative takes from
-- it. "Buyer pays $40 into escrow" is cash(buyer) -4000, escrow +4000. Because every journal
-- sums to zero, so does the whole ledger, and every balance can be rebuilt from history.
-- The ledger is append-only: a mistake is corrected by a new journal, never by editing one.

-- The seller's fee for a trade, fixed when the trade is made (fees and seller levels come
-- later; until then it's 0). It's taken out of the seller's payout when the trade completes.
ALTER TABLE trades
  ADD COLUMN seller_fee_cents integer NOT NULL DEFAULT 0
    CHECK (seller_fee_cents >= 0 AND seller_fee_cents < price_cents);

CREATE TABLE ledger_journals (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('signup_grant', 'trade_payment', 'trade_payout',
                                           'trade_refund', 'adjustment')),
  trade_id   bigint REFERENCES trades (id),
  memo       text NOT NULL DEFAULT '' CHECK (length(memo) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_journals_trade CHECK ((kind LIKE 'trade_%') = (trade_id IS NOT NULL))
);
-- A trade is paid for once, and settles (paid out or refunded) at most once.
CREATE UNIQUE INDEX ledger_journals_one_payment ON ledger_journals (trade_id)
  WHERE kind = 'trade_payment';
CREATE UNIQUE INDEX ledger_journals_one_settlement ON ledger_journals (trade_id)
  WHERE kind IN ('trade_payout', 'trade_refund');

CREATE TABLE ledger_entries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_id   bigint NOT NULL REFERENCES ledger_journals (id),
  account      text NOT NULL CHECK (account IN ('cash', 'escrow', 'fees', 'issued')),
  user_id      bigint REFERENCES users (id),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  CONSTRAINT ledger_entries_cash_has_user CHECK ((account = 'cash') = (user_id IS NOT NULL))
);
CREATE INDEX ledger_entries_journal_idx ON ledger_entries (journal_id);
CREATE INDEX ledger_entries_user_idx ON ledger_entries (user_id, journal_id) WHERE user_id IS NOT NULL;

-- The database refuses a journal that doesn't add up to zero. The check is deferred to
-- COMMIT, so a journal's entries can be inserted one by one inside its transaction.
CREATE FUNCTION ledger_check_journal_balanced() RETURNS trigger AS $$
DECLARE
  total bigint;
BEGIN
  SELECT sum(amount_cents) INTO total FROM ledger_entries WHERE journal_id = NEW.journal_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger journal % does not balance (off by % cents)', NEW.journal_id, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_journal_balanced();

-- Append-only: no entry or journal is ever changed or removed.
CREATE FUNCTION ledger_refuse_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'the ledger is append-only: post a correcting journal instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();
CREATE TRIGGER ledger_journals_append_only BEFORE UPDATE OR DELETE ON ledger_journals
  FOR EACH ROW EXECUTE FUNCTION ledger_refuse_change();

-- Everyone starts with $2,000 (users.cash_cents DEFAULT): post it as a grant from `issued`
-- whenever a user is created, however they're created (sign up, the demo seed, tests).
CREATE FUNCTION ledger_signup_grant() RETURNS trigger AS $$
DECLARE
  journal bigint;
BEGIN
  INSERT INTO ledger_journals (kind, memo, created_at)
    VALUES ('signup_grant', 'Starting play money', NEW.created_at) RETURNING id INTO journal;
  INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
    VALUES (journal, 'cash', NEW.id, NEW.cash_cents), (journal, 'issued', NULL, -NEW.cash_cents);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_signup_grant AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION ledger_signup_grant();

-- History from before the ledger: grants for existing users, then each existing trade's
-- payment and, if it settled, its payout or refund, at the times they happened.
DO $$
DECLARE
  u record;
  t record;
  journal bigint;
  ledger_cash bigint;
BEGIN
  FOR u IN SELECT id, created_at FROM users ORDER BY id LOOP
    INSERT INTO ledger_journals (kind, memo, created_at)
      VALUES ('signup_grant', 'Starting play money', u.created_at) RETURNING id INTO journal;
    INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
      VALUES (journal, 'cash', u.id, 200000), (journal, 'issued', NULL, -200000);
  END LOOP;

  FOR t IN SELECT * FROM trades ORDER BY id LOOP
    INSERT INTO ledger_journals (kind, trade_id, created_at)
      VALUES ('trade_payment', t.id, t.created_at) RETURNING id INTO journal;
    INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
      VALUES (journal, 'cash', t.buyer_id, -t.price_cents), (journal, 'escrow', NULL, t.price_cents);
    IF t.status IN ('completed', 'refunded') THEN
      INSERT INTO ledger_journals (kind, trade_id, created_at)
        VALUES (CASE WHEN t.status = 'completed' THEN 'trade_payout' ELSE 'trade_refund' END,
                t.id, coalesce(t.settled_at, t.updated_at))
        RETURNING id INTO journal;
      INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
        VALUES (journal, 'escrow', NULL, -t.price_cents),
               (journal, 'cash', CASE WHEN t.status = 'completed' THEN t.seller_id ELSE t.buyer_id END,
                t.price_cents);
    END IF;
  END LOOP;

  -- If any wallet doesn't match its history (money moved by hand before the ledger), record
  -- the difference as an opening correction, so the books start out exact and say so.
  FOR u IN SELECT id, cash_cents FROM users ORDER BY id LOOP
    SELECT coalesce(sum(amount_cents), 0) INTO ledger_cash
      FROM ledger_entries WHERE account = 'cash' AND user_id = u.id;
    IF ledger_cash <> u.cash_cents THEN
      INSERT INTO ledger_journals (kind, memo)
        VALUES ('adjustment', 'Opening correction: wallet differed from trade history')
        RETURNING id INTO journal;
      INSERT INTO ledger_entries (journal_id, account, user_id, amount_cents)
        VALUES (journal, 'cash', u.id, u.cash_cents - ledger_cash),
               (journal, 'issued', NULL, ledger_cash - u.cash_cents);
    END IF;
  END LOOP;
END;
$$;
