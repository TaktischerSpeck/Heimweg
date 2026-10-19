import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, point, matrix } from './helpers.js';
import { createApp } from '../src/app.js';

test('CRUD validates coordinates, requires a station and encrypts personal fields', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  await f.login();
  const child = { name: 'Synthetic Test Child', ...point };
  assert.equal((await f.request('/api/children', 'POST', child)).status, 400);
  assert.equal(
    (await f.request('/api/station', 'PUT', { ...point, confirmed: false })).status,
    400,
  );
  await f.request('/api/station', 'PUT', point);
  assert.equal((await f.request('/api/children', 'POST', { ...child, lat: null })).status, 400);
  assert.equal((await f.request('/api/children', 'POST', child)).status, 201);
  const row = (await f.pool.query('SELECT * FROM children')).rows[0];
  assert.ok(!JSON.stringify(row).includes(child.name));
  assert.ok(!JSON.stringify(row).includes(point.address));
  assert.ok(!JSON.stringify(row).includes('49.8'));
  const read = await f.request('/api/data');
  assert.equal(read.data.children[0].name, child.name);
  assert.equal(
    (
      await f.request(`/api/children/${row.id}`, 'PUT', {
        ...child,
        name: 'Synthetic Updated Child',
      })
    ).status,
    200,
  );
  const restored = await createApp(f.pool, f.config);
  restored.close();
  assert.equal((await f.request('/api/data')).data.children[0].name, 'Synthetic Updated Child');
  await assert.rejects(createApp(f.pool, { ...f.config, encryptionKey: 'ff'.repeat(32) }));
  await f.request(`/api/children/${row.id}`, 'DELETE');
  assert.equal((await f.pool.query('SELECT * FROM children')).rowCount, 0);
});
test('vehicle seats, unique names and updates', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  await f.login();
  for (const seats of [0, -1, 2.5, '9', 101])
    assert.equal((await f.request('/api/vehicles', 'POST', { name: 'MTF', seats })).status, 400);
  assert.equal((await f.request('/api/vehicles', 'POST', { name: 'MTF', seats: 9 })).status, 201);
  assert.equal((await f.request('/api/vehicles', 'POST', { name: 'mtf', seats: 6 })).status, 409);
  const vehicle = (await f.request('/api/data')).data.vehicles[0];
  assert.equal(
    (await f.request(`/api/vehicles/${vehicle.id}`, 'PUT', { name: 'MTF 1', seats: 8 })).status,
    200,
  );
  assert.equal((await f.request(`/api/vehicles/${vehicle.id}`, 'DELETE')).status, 200);
});
test('planning endpoint uses only selected IDs, rejects capacity and revision errors, stores no history', async (t) => {
  let count = 0;
  const f = await fixture({
    roadMatrix: async (_, points) => {
      count++;
      return matrix(points.length - 1);
    },
  });
  t.after(f.close);
  await f.setup();
  await f.login();
  await f.request('/api/station', 'PUT', point);
  for (let i = 0; i < 3; i++)
    await f.request('/api/children', 'POST', { ...point, name: `Synthetic ${i}` });
  await f.request('/api/vehicles', 'POST', { name: 'MTF', seats: 3 });
  const data = (await f.request('/api/data')).data;
  const body = {
    children: data.children.slice(0, 2).map((c) => c.id),
    vehicles: [{ id: data.vehicles[0].id, supervisors: 1 }],
    revision: data.revision,
    timeLimitSeconds: 5,
  };
  assert.equal((await f.request('/api/plan', 'POST', { ...body, children: [] })).status, 400);
  assert.equal((await f.request('/api/plan', 'POST', { ...body, vehicles: [] })).status, 400);
  assert.equal((await f.request('/api/plan', 'POST', { ...body, revision: 'old' })).status, 409);
  assert.equal(
    (
      await f.request('/api/plan', 'POST', {
        ...body,
        vehicles: [{ id: data.vehicles[0].id, supervisors: 2 }],
      })
    ).status,
    400,
  );
  assert.equal(count, 0);
  const result = await f.request('/api/plan', 'POST', body);
  assert.equal(result.status, 200);
  assert.equal(result.data.variants[0].routes.flatMap((r) => r.stops).length, 2);
  assert.ok(!JSON.stringify(result.data).includes(data.children[2].id));
  const tables = (
    await f.pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    )
  ).rows.map((r) => r.table_name);
  assert.ok(!tables.includes('plans'));
});
