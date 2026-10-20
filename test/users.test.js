import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, database } from './helpers.js';
import { migrate } from '../src/db.js';

const password = 'synthetic-user-password-123';
function client(f) {
  let cookie = '', csrf = '';
  return async (path, method = 'GET', body) => {
    const response = await fetch(f.url + '/api' + path, { method, headers: {
      Origin: f.config.origin, Cookie: cookie, 'X-CSRF-Token': csrf,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data };
  };
}

test('user management requires an admin and CSRF, normal users retain application access', async t => {
  const f = await fixture(); t.after(f.close);
  assert.equal((await f.request('/api/users')).status, 401);
  await f.setup(); await f.login();
  const me = (await f.request('/api/data')).data.currentUser;
  assert.equal(me.role, 'admin');
  assert.equal((await f.request('/api/users', 'POST', { username: 'normal', password }, { 'X-CSRF-Token': '' })).status, 403);
  const created = await f.request('/api/users', 'POST', { username: ' Normal ', password });
  assert.equal(created.status, 201);
  assert.equal(created.data.username, 'normal');
  assert.equal(created.data.role, 'user');
  assert.equal((await f.request('/api/users', 'POST', { username: 'NORMAL', password })).status, 409);
  assert.equal((await f.request('/api/users', 'POST', { username: 'short', password: 'short' })).status, 400);
  assert.equal((await f.request('/api/users', 'POST', { username: 'role', password, role: 'root' })).status, 400);
  const accounts = (await f.request('/api/users')).data.users;
  assert.equal(accounts.length, 2);
  assert.ok(accounts.every(account => !('password_hash' in account)));
  const user = client(f);
  assert.equal((await user('/login', 'POST', { username: 'normal', password })).status, 200);
  assert.equal((await user('/data')).status, 200);
  assert.equal((await user('/data')).data.currentUser.role, 'user');
  for (const [path, method, body] of [
    ['/users', 'GET'], ['/users', 'POST', { username: 'bad', password, role: 'admin' }],
    ['/users/' + created.data.id, 'PATCH', { role: 'admin' }],
    ['/users/' + me.id + '/password', 'POST', { password }],
  ]) assert.equal((await user(path, method, body)).status, 403);
  assert.equal((await f.request('/api/users/' + me.id, 'PATCH', { locked: true })).status, 409);
  assert.equal((await f.request('/api/users/' + me.id, 'PATCH', { role: 'user' })).status, 409);
});

test('password resets revoke sessions, preserve locks, and unlocking restores login', async t => {
  const f = await fixture(); t.after(f.close);
  await f.setup(); await f.login();
  const id = (await f.request('/api/users', 'POST', { username: 'member', password })).data.id;
  const member = client(f);
  await member('/login', 'POST', { username: 'member', password });
  assert.equal((await f.request('/api/users/' + id + '/password', 'POST', { password: password + '-new' })).status, 200);
  assert.equal((await member('/data')).status, 401);
  assert.equal((await member('/login', 'POST', { username: 'member', password })).status, 401);
  assert.equal((await member('/login', 'POST', { username: 'member', password: password + '-new' })).status, 200);
  assert.equal((await f.request('/api/users/' + id, 'PATCH', { locked: true })).status, 200);
  assert.equal((await member('/data')).status, 401);
  await f.request('/api/users/' + id + '/password', 'POST', { password });
  assert.equal((await member('/login', 'POST', { username: 'member', password })).status, 401);
  await f.request('/api/users/' + id, 'PATCH', { locked: false });
  assert.equal((await member('/login', 'POST', { username: 'member', password })).status, 200);
  await f.request('/api/users/' + id, 'PATCH', { role: 'admin' });
  assert.equal((await member('/data')).status, 401);
  await member('/login', 'POST', { username: 'member', password });
  assert.equal((await member('/users')).status, 200);
  await f.request('/api/users/' + id, 'PATCH', { role: 'user' });
  assert.equal((await member('/users')).status, 401);
  const ownId = (await f.request('/api/data')).data.currentUser.id;
  await f.request('/api/users/' + ownId + '/password', 'POST', { password });
  assert.equal((await f.request('/api/data')).status, 401);
});

test('concurrent administrators cannot lock each other and leave no active administrator', async t => {
  const f = await fixture(); t.after(f.close);
  await f.setup(); await f.login();
  const first = (await f.request('/api/data')).data.currentUser.id;
  const second = (await f.request('/api/users', 'POST', { username: 'second', password, role: 'admin' })).data.id;
  const a = client(f), b = client(f);
  await a('/login', 'POST', { username: 'admin', password: 'correct-password-123' });
  await b('/login', 'POST', { username: 'second', password });
  const responses = await Promise.all([
    a('/users/' + second, 'PATCH', { locked: true }),
    b('/users/' + first, 'PATCH', { locked: true }),
  ]);
  assert.equal(responses.filter(r => r.status === 200).length, 1);
  assert.ok(responses.some(r => [401, 403].includes(r.status)));
  assert.equal((await f.pool.query("SELECT id FROM users WHERE role = 'admin' AND locked = false")).rowCount, 1);
});

test('role migration preserves existing credentials and promotes legacy accounts', async t => {
  const pool = await database(); t.after(() => pool.end());
  await pool.query('ALTER TABLE users DROP COLUMN role');
  await pool.query("DELETE FROM schema_migrations WHERE version = '002_user_roles.sql'");
  await pool.query('INSERT INTO users(id, username, password_hash) VALUES ($1, $2, $3)',
    ['00000000-0000-4000-8000-000000000001', 'legacy-admin', 'synthetic-existing-hash']);
  await migrate(pool);
  await migrate(pool);
  const user = (await pool.query('SELECT * FROM users')).rows[0];
  assert.equal(user.role, 'admin');
  assert.equal(user.password_hash, 'synthetic-existing-hash');
});
