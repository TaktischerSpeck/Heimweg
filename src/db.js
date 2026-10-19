import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';

export function createPool(config) {
  return new pg.Pool(config.database);
}
export async function transaction(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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
