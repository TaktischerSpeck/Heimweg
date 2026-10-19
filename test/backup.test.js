import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptBackup, decryptBackup } from '../scripts/backup.js';
import { database, point } from './helpers.js';
import { cipher } from '../src/security.js';
import { migrate } from '../src/db.js';

test('encrypted backup restores records after migrations and fails with wrong keys or tampering', async (t) => {
  const pool = await database();
  t.after(() => pool.end());
  const key = randomBytes(32),
    crypt = cipher(randomBytes(32).toString('hex'));
  const id = '00000000-0000-0000-0000-000000000001',
    value = { name: 'Synthetic Backup Child', ...point };
  await pool.query('INSERT INTO children(id, encrypted_data) VALUES ($1, $2)', [
    id,
    crypt.encrypt(value, `child:${id}`),
  ]);
  const exported = Buffer.from(JSON.stringify((await pool.query('SELECT * FROM children')).rows));
  const backup = encryptBackup(exported, key);
  assert.ok(!backup.includes(Buffer.from(value.name)));
  await pool.query('DELETE FROM children');
  await migrate(pool);
  const recovered = JSON.parse(decryptBackup(backup, key).toString());
  for (const row of recovered)
    await pool.query('INSERT INTO children(id, encrypted_data) VALUES ($1, $2)', [
      row.id,
      row.encrypted_data,
    ]);
  assert.deepEqual(
    crypt.decrypt(
      (await pool.query('SELECT * FROM children')).rows[0].encrypted_data,
      `child:${id}`,
    ),
    value,
  );
  assert.throws(() => decryptBackup(backup, randomBytes(32)));
  backup[backup.length - 1] ^= 1;
  assert.throws(() => decryptBackup(backup, key));
});
