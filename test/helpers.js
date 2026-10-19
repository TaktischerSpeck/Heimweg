import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { migrate } from '../src/db.js';
import { createApp } from '../src/app.js';

export async function database() {
  if (process.env.TEST_DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await migrate(pool);
    return pool;
  }
  const db = new PGlite();
  let queue = Promise.resolve();
  async function acquire() {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
  async function query(sql, values) {
    const result = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  }
  const pool = {
    async query(sql, values) {
      const release = await acquire();
      try {
        return await query(sql, values);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
    end: () => db.close(),
  };
  await migrate(pool);
  return pool;
}
export async function fixture(dependencies = {}) {
  const pool = await database();
  const config = {
    encryptionKey: randomBytes(32).toString('hex'),
    setupToken: 'setup-token-for-testing-only-000000000',
    production: false,
    origin: 'http://localhost',
    services: { routing: 'http://routing', geocoding: 'http://geocoding' },
    providerMode: 'self-hosted',
  };
  const server = await createApp(pool, config, dependencies);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  let cookie = '',
    csrf = '';
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(url + path, {
      method,
      headers: {
        Origin: config.origin,
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    if (data.csrfToken) csrf = data.csrfToken;
    return { status: response.status, data, headers: response.headers };
  }
  async function setup() {
    return request('/api/setup', 'POST', {
      username: 'admin',
      password: 'correct-password-123',
      setupToken: config.setupToken,
    });
  }
  async function login(password = 'correct-password-123') {
    return request('/api/login', 'POST', { username: 'admin', password });
  }
  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
  return { pool, config, server, url, request, setup, login, close };
}
export const point = {
  address: 'Synthetic Test Road 10, Test Town',
  lat: 49.8,
  lon: 8.7,
  confirmed: true,
};
export function matrix(n) {
  return {
    durations: Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => Math.abs(i - j) * 60),
    ),
    distances: Array.from({ length: n + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => Math.abs(i - j) * 600),
    ),
  };
}
