import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createMariaPool } from './mariadb.js';

export function createPool(config) {
  if (config.databaseEngine === 'mariadb') return createMariaPool(config.database);
  return new pg.Pool(config.database);
}
export async function transaction(pool, callback, repeatableRead = false) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // MariaDB connections already use REPEATABLE READ before starting the transaction.
    if (repeatableRead && pool.dialect !== 'mariadb')
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function migrate(pool) {
  if (pool.dialect === 'mariadb') return migrateMaria(pool);
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const directory = new URL('../migrations/', import.meta.url);
  await transaction(pool, async (client) => {
    await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    for (const version of (await readdir(directory))
      .filter((file) => file.endsWith('.sql'))
      .sort()) {
      const exists = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version],
      );
      if (exists.rowCount) continue;
      await client.query(await readFile(new URL(version, directory), 'utf8'));
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    }
  });
}
async function migrateMaria(pool) {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT GET_LOCK(CONCAT(DATABASE(), ':heimweg:migrate'), 30) AS acquired",
    );
    if (Number(lock.rows[0].acquired) !== 1) throw new Error('Migration lock unavailable.');
    locked = true;
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version varchar(255) PRIMARY KEY, applied_at datetime(3) NOT NULL DEFAULT current_timestamp(3)) ENGINE=InnoDB',
    );
    const directory = new URL('../migrations/mariadb/', import.meta.url);
    for (const version of (await readdir(directory))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (
        (await client.query('SELECT version FROM schema_migrations WHERE version = $1', [version]))
          .rowCount
      )
        continue;
      // MariaDB DDL commits implicitly. Each migration must be safe to retry after interruption.
      const statements = (await readFile(new URL(version, directory), 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) await client.query(statement);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    }
  } finally {
    try {
      if (locked) await client.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':heimweg:migrate'))");
    } finally {
      client.release();
    }
  }
}
export async function setting(client, key, value, overwrite = false) {
  const sql =
    client.dialect === 'mariadb'
      ? `INSERT INTO settings(key, value) VALUES ($1, $2) ON DUPLICATE KEY UPDATE value = ${overwrite ? 'VALUES(value)' : 'value'}`
      : `INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO ${overwrite ? 'UPDATE SET value = EXCLUDED.value' : 'NOTHING'}`;
  return client.query(sql, [key, value]);
}
export async function bumpRevision(client) {
  await client.query(
    client.dialect === 'mariadb'
      ? "UPDATE settings SET value = CAST(CAST(value AS UNSIGNED) + 1 AS CHAR) WHERE key = 'revision'"
      : "UPDATE settings SET value = (value::bigint + 1)::text WHERE key = 'revision'",
  );
}
