import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMaria } from '../src/mariadb.js';
import { getConfig } from '../src/config.js';

test('MariaDB parameter mapping preserves quoted literals and reorders/reuses numbered values', () => {
  const query = compileMaria(
    'SELECT key, `key`, "value", \'$1 key\' FROM settings WHERE key = $2 OR value = $1 OR value = $2',
    ['first', 'second'],
  );
  assert.equal(
    query.sql,
    "SELECT `key`, `key`, `value`, '$1 key' FROM settings WHERE `key` = ? OR value = ? OR value = ?",
  );
  assert.deepEqual(query.parameters, ['second', 'first', 'second']);
});
test('external MariaDB settings override legacy PG configuration and preserve verified TLS', () => {
  const config = getConfig({
    ENCRYPTION_KEY: 'ab'.repeat(32),
    SETUP_TOKEN: 's'.repeat(32),
    DB_ENGINE: 'mariadb',
    DB_HOST: 'external.example',
    DB_NAME: 'test',
    DB_USER: 'testuser',
    DB_PASSWORD: 'synthetic',
    DB_SSL: 'true',
  });
  assert.equal(config.databaseEngine, 'mariadb');
  assert.equal(config.database.port, 3306);
  assert.equal(config.database.host, 'external.example');
  assert.equal(config.database.ssl.rejectUnauthorized, true);
});
