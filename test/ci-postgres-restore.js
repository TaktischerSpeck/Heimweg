// Exercise the real PostgreSQL dump/restore format without writing plaintext backup files.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cipher } from '../src/security.js';
import { encryptBackup, decryptBackup } from '../scripts/backup.js';
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const container = process.env.POSTGRES_CONTAINER;
if (!container) throw new Error('POSTGRES_CONTAINER is required.');
try {
  const key = randomBytes(32),
    crypt = cipher(randomBytes(32).toString('hex'));
  const id = '00000000-0000-0000-0000-000000000099',
    value = { name: 'Synthetic Restore Check', address: 'Synthetic Test Street', lat: 49, lon: 8 };
  await pool.query('INSERT INTO children(id, encrypted_data) VALUES ($1, $2)', [
    id,
    crypt.encrypt(value, `child:${id}`),
  ]);
  const dump = spawnSync(
    'docker',
    ['exec', container, 'pg_dump', '-U', 'heimweg', '-d', 'heimweg_test', '-Fc'],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(dump.status, 0, 'pg_dump failed.');
  const backup = encryptBackup(dump.stdout, key);
  await pool.query('DELETE FROM children');
  const restore = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '-U',
      'heimweg',
      '-d',
      'heimweg_test',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--exit-on-error',
      '--single-transaction',
    ],
    { input: decryptBackup(backup, key), maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(restore.status, 0, 'pg_restore failed.');
  const recovered = (await pool.query('SELECT encrypted_data FROM children WHERE id = $1', [id]))
    .rows[0];
  assert.deepEqual(crypt.decrypt(recovered.encrypted_data, `child:${id}`), value);
  console.log('PostgreSQL encrypted backup and restore passed.');
} finally {
  await pool.end();
}
