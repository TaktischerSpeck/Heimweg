import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { hashPassword } from './security.js';
import { ensure, string, uuid } from './validation.js';

function role(value) {
  ensure(['admin', 'user'].includes(value), 'Ungültige Rolle.');
  return value;
}
export async function listUsers(pool) {
  return (await pool.query('SELECT id, username, role, locked, failed_attempts FROM users ORDER BY username')).rows;
}
async function administer(pool, actorId, callback) {
  return transaction(pool, async client => {
    // Serialize account changes, then re-check the actor after acquiring the lock.
    await client.query("SELECT value FROM settings WHERE key = 'user_management_lock' FOR UPDATE");
    const actor = (await client.query('SELECT id, role, locked FROM users WHERE id = $1 FOR UPDATE', [actorId])).rows[0];
    ensure(actor && actor.role === 'admin' && !actor.locked, 'Nur Administratoren dürfen Benutzer verwalten.', 403);
    return callback(client);
  });
}
export async function createUser(pool, actorId, body) {
  const username = string(body.username, 'Benutzername', 3, 80).toLowerCase();
  const password = string(body.password, 'Passwort', 12, 128);
  const accountRole = role(body.role ?? 'user');
  const hash = await hashPassword(password);
  return administer(pool, actorId, async client => {
    ensure(!(await client.query('SELECT id FROM users WHERE username = $1', [username])).rowCount,
      'Dieser Benutzername ist bereits vergeben.', 409);
    const id = randomUUID();
    await client.query('INSERT INTO users(id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
      [id, username, hash, accountRole]);
    return { id, username, role: accountRole, locked: false, failed_attempts: 0 };
  });
}
export async function updateUser(pool, actorId, id, body) {
  uuid(id);
  ensure(Object.keys(body).length > 0 && Object.keys(body).every(key => ['role', 'locked'].includes(key)),
    'Nur Rolle oder Sperrstatus können geändert werden.');
  if (body.role !== undefined) role(body.role);
  if (body.locked !== undefined) ensure(typeof body.locked === 'boolean', 'Ungültiger Sperrstatus.');
  return administer(pool, actorId, async client => {
    const target = (await client.query('SELECT id, role, locked FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
    ensure(target, 'Benutzer nicht gefunden.', 404);
    const nextRole = body.role ?? target.role;
    const locked = body.locked ?? Boolean(target.locked);
    ensure(id !== actorId || (!locked && nextRole === 'admin'),
      'Das eigene Administratorkonto kann hier nicht gesperrt oder herabgestuft werden.', 409);
    if (target.role === 'admin' && !target.locked && (locked || nextRole !== 'admin')) {
      const admins = (await client.query("SELECT id FROM users WHERE role = 'admin' AND locked = false")).rows;
      ensure(admins.length > 1, 'Mindestens ein aktiver Administrator muss erhalten bleiben.', 409);
    }
    await client.query('UPDATE users SET role = $1, locked = $2, failed_attempts = $3 WHERE id = $4',
      [nextRole, locked, 0, id]);
    // Revoke existing sessions even on unlock, so accounts must authenticate again.
    await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return { ok: true };
  });
}
export async function resetUserPassword(pool, actorId, id, body) {
  uuid(id);
  const hash = await hashPassword(string(body.password, 'Passwort', 12, 128));
  return administer(pool, actorId, async client => {
    ensure((await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id])).rowCount,
      'Benutzer nicht gefunden.', 404);
    await client.query('UPDATE users SET password_hash = $1, failed_attempts = 0 WHERE id = $2', [hash, id]);
    await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return { ok: true };
  });
}
