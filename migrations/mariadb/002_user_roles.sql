ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user'));
UPDATE users SET role = 'admin';
