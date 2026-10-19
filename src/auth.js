import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { csrfFor, digest, equal, hashPassword, token, verifyPassword } from './security.js';
import { ensure, string } from './validation.js';

export async function rateLimit(pool, key, limit = 15, seconds = 900) {
  const hashed = digest(key);
  const { rows } = await pool.query(
    `INSERT INTO rate_limits(key, attempts, resets_at) VALUES ($1, 1, now() + $2 * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
    attempts = CASE WHEN rate_limits.resets_at <= now() THEN 1 ELSE rate_limits.attempts + 1 END,
    resets_at = CASE WHEN rate_limits.resets_at <= now() THEN now() + $2 * interval '1 second' ELSE rate_limits.resets_at END
    RETURNING attempts`,
    [hashed, seconds],
  );
  ensure(rows[0].attempts <= limit, 'Zu viele Anfragen. Bitte später erneut versuchen.', 429);
}
export async function setup(pool, config, body) {
  ensure(equal(body.setupToken, config.setupToken), 'Einrichtung nicht möglich.', 403);
  const username = string(body.username, 'Benutzername', 3, 80).toLowerCase();
  const password = string(body.password, 'Passwort', 12, 128);
  const hash = await hashPassword(password);
  await transaction(pool, async (client) => {
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const result = await client.query('SELECT id FROM users LIMIT 1');
    ensure(!result.rowCount, 'Die Ersteinrichtung ist bereits abgeschlossen.', 409);
    await client.query('INSERT INTO users(id, username, password_hash) VALUES ($1, $2, $3)', [
      randomUUID(),
      username,
      hash,
    ]);
  });
}
export async function login(pool, body, dummyHash, key) {
  const username = string(body.username, 'Benutzername', 1, 80).toLowerCase();
  const password = string(body.password, 'Passwort', 1, 128);
  // Hold the row lock across password verification so concurrent attempts cannot bypass the third-attempt lock.
  const result = await transaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM users WHERE username = $1 FOR UPDATE', [
      username,
    ]);
    const user = rows[0];
    const valid = await verifyPassword(user?.password_hash || dummyHash, password);
    if (!user || user.locked) return null;
    if (!valid) {
      await client.query(
        'UPDATE users SET failed_attempts = failed_attempts + 1, locked = (failed_attempts + 1 >= 3) WHERE id = $1',
        [user.id],
      );
      // Revoke sessions when the account becomes locked.
      if (user.failed_attempts >= 2)
        await client.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      return null;
    }
    await client.query('UPDATE users SET failed_attempts = 0 WHERE id = $1', [user.id]);
    const sessionToken = token();
    const csrfToken = csrfFor(sessionToken, key);
    await client.query(
      "INSERT INTO sessions(token_hash, user_id, csrf_hash, expires_at) VALUES ($1, $2, $3, now() + interval '30 minutes')",
      [digest(sessionToken), user.id, digest(csrfToken)],
    );
    return { sessionToken, csrfToken, username: user.username };
  });
  ensure(
    result,
    'Anmeldung nicht möglich. Zugangsdaten prüfen oder Administrator kontaktieren.',
    401,
  );
  return result;
}
export async function session(pool, request, key) {
  const raw = request.headers.cookie
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith('heimweg='))
    ?.slice(8);
  if (!raw || !/^[a-f\d]{64}$/.test(raw)) return null;
  const { rows } = await pool.query(
    `SELECT sessions.*, users.username FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE token_hash = $1 AND expires_at > now() AND users.locked = false`,
    [digest(raw)],
  );
  if (!rows.length) return null;
  await pool.query(
    "UPDATE sessions SET expires_at = now() + interval '30 minutes' WHERE token_hash = $1",
    [digest(raw)],
  );
  return { ...rows[0], csrfToken: csrfFor(raw, key) };
}
