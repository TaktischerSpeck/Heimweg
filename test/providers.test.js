import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { geocode, roadMatrix } from '../src/providers.js';
import { getConfig } from '../src/config.js';
import { point, matrix } from './helpers.js';

test('ORS uses server-side credentials, POST matrix and GeoJSON geocoding; missing routes fail', async (t) => {
  let responseBody, captured, payload, authorization;
  const server = createServer(async (request, response) => {
    captured = new URL(request.url, 'http://test');
    authorization = request.headers.authorization;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(responseBody));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  const config = {
    mapProvider: 'ors',
    providerMode: 'external',
    services: { routing: url, geocoding: url },
    orsKey: 'synthetic-api-key',
  };
  responseBody = {
    features: [{ geometry: { coordinates: [8.7, 49.8] }, properties: { label: point.address } }],
  };
  assert.deepEqual(await geocode(config, point.address), [
    { address: point.address, lat: 49.8, lon: 8.7 },
  ]);
  assert.equal(captured.searchParams.get('api_key'), config.orsKey);
  responseBody = matrix(1);
  assert.deepEqual((await roadMatrix(config, [point, point])).durations, responseBody.durations);
  assert.equal(captured.pathname, '/v2/matrix/driving-car');
  assert.equal(authorization, config.orsKey);
  assert.deepEqual(payload.locations, [
    [8.7, 49.8],
    [8.7, 49.8],
  ]);
  assert.deepEqual(payload.metrics, ['duration', 'distance']);
  responseBody = { ...matrix(1), sources: [{ snapped_distance: 501 }] };
  await assert.rejects(roadMatrix(config, [point, point]));
  responseBody = matrix(1);
  responseBody.durations[0][1] = null;
  await assert.rejects(roadMatrix(config, [point, point]));
});

test('external providers require explicit deployment approval and production requires HTTPS', () => {
  const base = {
    ENCRYPTION_KEY: 'ab'.repeat(32),
    SETUP_TOKEN: 's'.repeat(32),
    APP_ORIGIN: 'https://test.invalid',
    NODE_ENV: 'production',
  };
  assert.throws(() => getConfig({ ...base, PROVIDER_MODE: 'external' }));
  assert.equal(
    getConfig({ ...base, PROVIDER_MODE: 'external', ALLOW_EXTERNAL_LOCATION_DATA: 'true' })
      .providerMode,
    'external',
  );
  assert.throws(() => getConfig({ ...base, APP_ORIGIN: 'http://test.invalid' }));
  assert.throws(() => getConfig({ ...base, OSRM_URL: 'ftp://test.invalid' }));
});
test('provider adapters send explicit API parameters and reject unreachable/fallback routes', async (t) => {
  let responseBody, captured;
  const server = createServer((request, response) => {
    captured = new URL(request.url, 'http://test');
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(responseBody));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = { providerMode: 'self-hosted', services: { routing: base, geocoding: base } };
  responseBody = [{ display_name: point.address, lat: '49.8', lon: '8.7' }];
  assert.equal((await geocode(config, point.address))[0].lat, 49.8);
  assert.equal(captured.pathname, '/search');
  assert.equal(captured.searchParams.get('format'), 'jsonv2');
  responseBody = { code: 'Ok', ...matrix(1) };
  const data = await roadMatrix(config, [point, point]);
  assert.equal(data.durations.length, 2);
  assert.equal(captured.searchParams.get('annotations'), 'duration,distance');
  assert.equal(captured.searchParams.get('radiuses'), '500;500');
  responseBody = { code: 'Ok', ...matrix(1), fallback_speed_cells: [[0, 1]] };
  await assert.rejects(roadMatrix(config, [point, point]));
  responseBody = { code: 'NoSegment' };
  await assert.rejects(roadMatrix(config, [point, point]));
  await assert.rejects(geocode({ ...config, providerMode: 'disabled' }, point.address));
});
