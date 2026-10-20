import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { roadRoute, validateRouteGeometry } from '../src/providers.js';
import { getMapTiles } from '../src/config.js';
import { project, fitView, tilePlacements } from '../public/route-map.js';
import { fixture, point } from './helpers.js';

test('route maps validate finite GeoJSON and fit real Mercator geometry without external requests', () => {
  const geometry = { type: 'LineString', coordinates: [[8.7, 49.8], [8.704, 49.802], [8.71, 49.81]] };
  assert.deepEqual(validateRouteGeometry(geometry), geometry);
  for (const value of [
    null, { type: 'Point', coordinates: [8, 49] },
    { type: 'LineString', coordinates: [[8, 49]] },
    { type: 'LineString', coordinates: [[8, 49], [Infinity, 49]] },
    { type: 'LineString', coordinates: [[8, 49], [8, 91]] },
  ]) assert.throws(() => validateRouteGeometry(value));
  const points = geometry.coordinates.map(([lon, lat]) => project(lon, lat));
  const view = fitView(points, 600, 320);
  const size = 256 * 2 ** view.zoom;
  for (const p of points) {
    assert.ok(Math.abs(p[0] - view.center[0]) * size <= 260);
    assert.ok(Math.abs(p[1] - view.center[1]) * size <= 120);
  }
  assert.ok(Number.isFinite(fitView(Array(150000).fill(points[0]), 390, 300).zoom));
  assert.ok(tilePlacements(view.center, view.zoom, 600, 320).length <= 20);
  assert.equal(getMapTiles().external, true);
  assert.equal(getMapTiles().autoLoad, false);
  assert.equal(getMapTiles({ MAP_TILE_AUTO_LOAD: 'true' }).autoLoad, true);
  assert.equal(getMapTiles({ MAP_TILE_AUTO_LOAD: 'false' }).autoLoad, false);
  assert.equal(getMapTiles({ MAP_TILE_MODE: 'disabled' }), null);
  assert.throws(() => getMapTiles({ MAP_TILE_MODE: 'self-hosted' }));
  assert.throws(() => getMapTiles({ MAP_TILE_URL: 'https://user:secret@tiles.example.org/{z}/{x}/{y}.png' }));
  assert.throws(() => getMapTiles({ MAP_TILE_URL: 'https://tiles.example.org/{z}/{x}/{y}.png?key=secret' }));
  assert.equal(getMapTiles({ MAP_TILE_MODE: 'self-hosted',
    MAP_TILE_URL: 'https://tiles.example.org/{z}/{x}/{y}.png' }).external, false);
});

test('OSRM and ORS geometry adapters preserve ordered waypoints, isolate credentials and reject redirects', async t => {
  const points = [point, { ...point, lon: 8.71 }, { ...point, lat: 49.81 }];
  const geometry = { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) };
  let captured, payload, auth, mode = 'osrm', status = 200;
  const server = createServer(async (request, response) => {
    captured = new URL(request.url, 'http://fixture');
    auth = request.headers.authorization;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    response.writeHead(status, { 'Content-Type': 'application/json', Location: '/forbidden' });
    response.end(JSON.stringify(mode === 'osrm' ? {
      code: 'Ok', waypoints: points.map(() => ({ distance: 0 })), routes: [{ geometry }],
    } : { features: [{ geometry }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const config = { providerMode: 'self-hosted', mapProvider: 'osrm',
    services: { routing: 'http://127.0.0.1:' + server.address().port },
    providerAuth: { routing: { username: 'route-user', password: 'synthetic-password' },
      geocoding: { username: 'not-routing', password: 'unused' } } };
  assert.deepEqual(await roadRoute(config, points), geometry);
  assert.equal(captured.pathname, '/route/v1/driving/8.7,49.8;8.71,49.8;8.7,49.81');
  assert.equal(captured.searchParams.get('geometries'), 'geojson');
  assert.equal(captured.searchParams.get('overview'), 'full');
  assert.equal(auth, 'Basic ' + Buffer.from('route-user:synthetic-password').toString('base64'));
  status = 302;
  await assert.rejects(roadRoute(config, points));
  status = 403;
  await assert.rejects(roadRoute(config, points), error => /Zugriff verweigert/.test(error.message));
  status = 200; mode = 'ors';
  assert.deepEqual(await roadRoute({ ...config, mapProvider: 'ors', orsKey: 'synthetic-key' }, points), geometry);
  assert.equal(captured.pathname, '/v2/directions/driving-car/geojson');
  assert.deepEqual(payload.coordinates, geometry.coordinates);
  assert.equal(auth, 'synthetic-key');
});

test('route geometry API requires authentication and revision, preserves stop order, and handles return separately', async t => {
  const calls = [];
  const f = await fixture({ roadRoute: async (_, points) => {
    calls.push(points.map(p => p.lon));
    return { type: 'LineString', coordinates: points.map(p => [p.lon, p.lat]) };
  } });
  t.after(f.close);
  assert.equal((await f.request('/api/route-map', 'POST', {})).status, 401);
  await f.setup(); await f.login();
  await f.request('/api/station', 'PUT', point);
  await f.request('/api/children', 'POST', { ...point, lon: 8.71, name: 'Synthetic Alpha' });
  await f.request('/api/children', 'POST', { ...point, lon: 8.72, name: 'Synthetic Beta' });
  await f.request('/api/vehicles', 'POST', { name: 'Synthetic MTF', seats: 9 });
  const snapshot = (await f.request('/api/data')).data;
  const body = { children: snapshot.children.map(c => c.id).reverse(),
    revision: snapshot.revision, vehicleId: snapshot.vehicles[0].id, includeReturn: true };
  assert.equal((await f.request('/api/route-map', 'POST', { ...body, revision: 'old' })).status, 409);
  assert.equal((await f.request('/api/route-map', 'POST', { ...body, children: [body.children[0], body.children[0]] })).status, 400);
  assert.equal(calls.length, 0);
  const response = await f.request('/api/route-map', 'POST', body);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[8.7, 8.72, 8.71], [8.71, 8.7]]);
  assert.ok(response.data.returnGeometry);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  await f.request('/api/children/' + body.children[0], 'DELETE');
  assert.equal((await f.request('/api/route-map', 'POST', body)).status, 409);
  await f.request('/api/logout', 'POST', {});
  assert.equal((await f.request('/api/route-map', 'POST', body)).status, 401);
});
