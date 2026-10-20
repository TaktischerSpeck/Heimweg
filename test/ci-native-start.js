// Verify the native/Passenger entry point and a private .env against a disposable MariaDB.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { database } from './helpers.js';
if (!process.env.TEST_MARIADB_URL) throw new Error('A disposable TEST_MARIADB_URL is required.');
const pool = await database();
await pool.end();
const url = new URL(process.env.TEST_MARIADB_URL);
const directory = await mkdtemp(join(tmpdir(), 'heimweg-native-'));
const file = join(directory, 'heimweg.env');
const variables = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://synthetic.invalid',
  DB_ENGINE: 'mariadb',
  DB_HOST: url.hostname,
  DB_PORT: url.port || '3306',
  DB_NAME: url.pathname.slice(1),
  DB_USER: decodeURIComponent(url.username),
  DB_PASSWORD: decodeURIComponent(url.password),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  SETUP_TOKEN: randomBytes(32).toString('hex'),
  PROVIDER_MODE: 'disabled',
  PORT: '3102',
  HOST: '127.0.0.1',
};
await writeFile(
  file,
  Object.entries(variables)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join('\n'),
  { mode: 0o600 },
);
const child = spawn(process.execPath, ['app.cjs'], {
  env: { ...process.env, HEIMWEG_ENV_FILE: file },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let errorOutput = '';
child.stderr.on('data', (chunk) => {
  errorOutput += chunk;
});
try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Native startup exited before becoming healthy.');
    try {
      healthy = (await fetch('http://127.0.0.1:3102/healthz')).ok;
    } catch {
      /* Await startup. */
    }
    if (healthy) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, 'Native startup did not become healthy.');
  assert.equal((await fetch('http://127.0.0.1:3102/api/data')).status, 401);
  assert.equal(errorOutput, '');
  console.log('Native app.cjs startup with private .env and MariaDB passed.');
} finally {
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
  child.kill('SIGTERM');
  await exited;
  await rm(directory, { recursive: true, force: true });
}
