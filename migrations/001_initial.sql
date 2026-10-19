CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked boolean NOT NULL DEFAULT false
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE children (id uuid PRIMARY KEY, encrypted_data text NOT NULL);
CREATE TABLE vehicles (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX vehicles_name_unique ON vehicles (lower(name));
CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at timestamptz NOT NULL
);
