import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getConfig } from '../src/config.js';
import { geocode, roadMatrix } from '../src/providers.js';
import { fixture, point, matrix } from './helpers.js';

const base = {
  ENCRYPTION_KEY: 'ab'.repeat(32),
  SETUP_TOKEN: 's'.repeat(32),
  MAP_PROVIDER: 'osrm',
  PROVIDER_MODE: 'self-hosted',
  OSRM_URL: 'https://routing.example.org',
  NOMINATIM_URL: 'https://geocoding.example.org',
};
test('provider passwords require HTTPS and complete credentials; secret files are supported', async (t) => {
  assert.throws(() => getConfig({ ...base, OSRM_USERNAME: 'heimweg' }));
  assert.throws(() => getConfig({ ...base, OSRM_PASSWORD: 'synthetic' }));
  assert.throws(() =>
    getConfig({
      ...base,
      OSRM_URL: 'http://routing.example.org',
      OSRM_USERNAME: 'heimweg',
      OSRM_PASSWORD: 'synthetic',
    }),
  );
  assert.throws(() =>
    getConfig({ ...base, OSRM_USERNAME: 'unsafe:user', OSRM_PASSWORD: 'synthetic' }),
  );
  const directory = await mkdtemp(join(tmpdir(), 'heimweg-provider-auth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'password');
  await writeFile(file, 'synthetic-file-password\n', { mode: 0o600 });
  const config = getConfig({ ...base, OSRM_USERNAME: 'heimweg', OSRM_PASSWORD_FILE: file });
  assert.equal(config.providerAuth.routing.password, 'synthetic-file-password');
  assert.equal(config.providerAuth.geocoding, null);
});
test('routing/geocoding credentials are isolated; redirects and denied credentials expose no secrets', async (t) => {
  let requestHeaders,
    status = 200,
    redirectRequests = 0;
  const trap = createServer((request, response) => {
    redirectRequests++;
    response.end('{}');
  });
  await new Promise((resolve) => trap.listen(0, '127.0.0.1', resolve));
  const server = createServer((request, response) => {
    requestHeaders = request.headers;
    if (status === 302) {
      response.writeHead(302, { Location: `http://127.0.0.1:${trap.address().port}/steal` });
      return response.end();
    }
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify(request.url.startsWith('/search') ? [] : { code: 'Ok', ...matrix(1) }),
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    trap.closeAllConnections();
    return Promise.all([
      new Promise((resolve) => server.close(resolve)),
      new Promise((resolve) => trap.close(resolve)),
    ]);
  });
  // Local HTTP fixtures exercise headers only; deployment configuration rejects HTTP credentials.
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const config = {
    providerMode: 'self-hosted',
    mapProvider: 'osrm',
    services: { routing: endpoint, geocoding: endpoint },
    providerAuth: { routing: { username: 'route-user', password: 'synthetic-route-password' } },
  };
  await roadMatrix(config, [point, point]);
  assert.equal(
    requestHeaders.authorization,
    'Basic ' + Buffer.from('route-user:synthetic-route-password').toString('base64'),
  );
  await geocode(config, point.address);
  assert.equal(requestHeaders.authorization, undefined);
  config.providerAuth.geocoding = { username: 'geo-user', password: 'synthetic-geo-password' };
  await geocode(config, point.address);
  assert.equal(
    requestHeaders.authorization,
    'Basic ' + Buffer.from('geo-user:synthetic-geo-password').toString('base64'),
  );
  status = 401;
  await assert.rejects(
    roadMatrix(config, [point, point]),
    (error) =>
      error.status === 502 &&
      /Zugriff verweigert/.test(error.message) &&
      !error.message.includes('synthetic'),
  );
  status = 302;
  await assert.rejects(roadMatrix(config, [point, point]));
  assert.equal(redirectRequests, 0);
});
test('provider credentials are never included in authenticated browser bootstrap data', async (t) => {
  const f = await fixture();
  t.after(f.close);
  f.config.providerAuth = {
    routing: { username: 'synthetic-private-user', password: 'synthetic-private-password' },
  };
  await f.setup();
  await f.login();
  const response = await f.request('/api/data');
  const payload = JSON.stringify(response.data);
  assert.ok(!payload.includes('synthetic-private-user'));
  assert.ok(!payload.includes('synthetic-private-password'));
  assert.ok(!payload.includes('providerAuth'));
});
