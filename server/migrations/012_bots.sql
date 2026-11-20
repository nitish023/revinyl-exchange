-- Market-making bots (Part 19). A bot is an ordinary user (same wallet, same orders, same
-- rules) that the site labels as a market maker wherever it appears, so nobody mistakes it
-- for a collector. Bots can't log in: their password is random and never stored anywhere.
ALTER TABLE users ADD COLUMN is_bot boolean NOT NULL DEFAULT false;
