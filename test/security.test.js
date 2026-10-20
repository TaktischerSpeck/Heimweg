import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cipher, hashPassword, verifyPassword } from '../src/security.js';
import { fixture, point } from './helpers.js';
import { migrate } from '../src/db.js';

test('authenticated encryption hides PII, uses random nonces and rejects tampering and record swaps', () => {
  const crypt = cipher('ab'.repeat(32)),
    value = { name: 'Synthetic Child', ...point };
  const first = crypt.encrypt(value, 'child:1'),
    second = crypt.encrypt(value, 'child:1');
  assert.notEqual(first, second);
  assert.ok(!first.includes(value.name));
  assert.ok(!first.includes(point.address));
  assert.deepEqual(crypt.decrypt(first, 'child:1'), value);
  assert.throws(() => crypt.decrypt(first, 'child:2'));
  assert.throws(() => cipher('cd'.repeat(32)).decrypt(first, 'child:1'));
  const pieces = first.split('.');
  pieces[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => crypt.decrypt(pieces.join('.'), 'child:1'));
});
test('passwords are Argon2id hashes', async () => {
  const hash = await hashPassword('synthetic-password-123');
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, 'synthetic-password-123'), true);
  assert.equal(await verifyPassword(hash, 'wrong'), false);
});
test('setup token, one-time initialization, sessions, CSRF and logout', async (t) => {
  const f = await fixture();
  t.after(f.close);
  assert.equal((await f.request('/api/data')).status, 401);
  assert.equal(
    (
      await f.request('/api/setup', 'POST', {
        username: 'admin',
        password: 'correct-password-123',
        setupToken: 'wrong',
      })
    ).status,
    403,
  );
  assert.equal((await f.setup()).status, 201);
  assert.equal((await f.setup()).status, 409);
  assert.equal((await f.login()).status, 200);
  const data = await f.request('/api/data');
  assert.deepEqual(data.data.children, []);
  assert.deepEqual(data.data.vehicles, []);
  assert.match(data.headers.get('cache-control'), /no-store/);
  assert.equal(
    (await f.request('/api/station', 'PUT', point, { Origin: 'https://evil.invalid' })).status,
    403,
  );
  assert.equal(
    (await f.request('/api/station', 'PUT', point, { 'X-CSRF-Token': 'invalid' })).status,
    403,
  );
  assert.equal((await f.request('/api/station', 'PUT', point)).status, 200);
  assert.equal((await f.request('/api/logout', 'POST', {})).status, 200);
  assert.equal((await f.request('/api/data')).status, 401);
  await migrate(f.pool);
  assert.equal((await f.pool.query('SELECT * FROM schema_migrations')).rowCount, 1);
});
test('failed attempts 1 and 2, success resets counter, third failure permanently locks', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  for (let i = 1; i <= 2; i++) {
    assert.equal((await f.login('wrong')).status, 401);
    const row = (await f.pool.query('SELECT * FROM users')).rows[0];
    assert.equal(row.failed_attempts, i);
    assert.equal(row.locked, false);
  }
  await f.login();
  assert.equal((await f.pool.query('SELECT * FROM users')).rows[0].failed_attempts, 0);
  await Promise.all([f.login('wrong'), f.login('wrong'), f.login('wrong')]);
  const row = (await f.pool.query('SELECT * FROM users')).rows[0];
  assert.equal(row.failed_attempts, 3);
  assert.equal(row.locked, true);
  assert.equal((await f.login()).status, 401);
  assert.equal((await f.request('/api/data')).status, 401);
  assert.equal((await f.pool.query('SELECT * FROM sessions')).rowCount, 0);
  await f.pool.query('UPDATE users SET locked = false, failed_attempts = 0');
  assert.equal((await f.login()).status, 200);
});
test('unknown user response is generic; IP throttling persists in database', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  const known = await f.login('wrong');
  const unknown = await f.request('/api/login', 'POST', { username: 'missing', password: 'wrong' });
  assert.equal(known.data.error, unknown.data.error);
  for (let i = 2; i < 15; i++)
    await f.request('/api/login', 'POST', { username: 'missing', password: 'wrong' });
  assert.equal((await f.login()).status, 429);
});
test('session expiration and secure cookie in production', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  f.config.production = true;
  const logged = await f.login();
  assert.match(logged.headers.get('set-cookie'), /HttpOnly/);
  assert.match(logged.headers.get('set-cookie'), /Secure/);
  assert.match(logged.headers.get('set-cookie'), /SameSite=Strict/);
  await f.pool.query('UPDATE sessions SET expires_at = $1', [new Date(Date.now() - 1000)]);
  assert.equal((await f.request('/api/data')).status, 401);
});
