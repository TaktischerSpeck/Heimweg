CREATE TABLE IF NOT EXISTS users (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  username varchar(80) COLLATE utf8mb4_bin NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked boolean NOT NULL DEFAULT false
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash char(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_hash char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at datetime(3) NOT NULL,
  INDEX sessions_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS children (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  encrypted_data text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS vehicles (
  id char(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  name varchar(80) NOT NULL,
  seats integer NOT NULL CHECK (seats BETWEEN 1 AND 100),
  name_key varchar(80) AS (lower(name)) PERSISTENT,
  UNIQUE INDEX vehicles_name_unique (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS settings (
  `key` varchar(80) PRIMARY KEY,
  value text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
CREATE TABLE IF NOT EXISTS rate_limits (
  `key` char(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attempts integer NOT NULL,
  resets_at datetime(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
INSERT INTO settings (`key`, value) VALUES ('setup_lock', '1')
ON DUPLICATE KEY UPDATE value = value;
