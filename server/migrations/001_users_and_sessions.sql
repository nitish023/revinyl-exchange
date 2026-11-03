-- Accounts and login sessions.
-- Emails are stored lower-case; display names are unique ignoring case.
-- A session row stores only the SHA-256 hash of the cookie token, so a leaked
-- database can't be used to log in as anyone.

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL CHECK (email = lower(email) AND length(email) <= 254),
  display_name  text NOT NULL CHECK (display_name ~ '^[A-Za-z0-9_-]{3,24}$'),
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);
CREATE UNIQUE INDEX users_display_name_key ON users (lower(display_name));

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
