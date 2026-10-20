import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportCsv, previewImport } from '../src/csv.js';
import { fixture, point } from './helpers.js';

test('CSV roundtrip preserves Unicode, multiline addresses, quotes, formula protection and negative coordinates', () => {
  for (const name of ['Änne Müller', '=SUM(1;2)', ' +test', "'Original", '-Name']) {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      name: name.trim(),
      address: 'Synthetic "Road"; 10\nTest Town',
      lat: -49.5,
      lon: 8.7,
      confirmed: true,
    };
    const csv = exportCsv('children', [row]);
    const preview = previewImport(csv, 'children', [row]);
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.rows[0].data, row);
    assert.equal(preview.rows[0].action, 'update');
    if (name.startsWith('=')) assert.match(csv, /'=SUM/);
  }
});
test('CSV supports German headers and decimal commas, pending addresses, validation and duplicate protection', () => {
  const a = previewImport(
    'Name;Adresse;Breitengrad;Längengrad;Geprüft\r\nSynthetic;Synthetic Road 10;49,8;8,7;ja\r\n',
    'children',
    [],
  );
  assert.equal(a.valid, true);
  assert.equal(a.rows[0].data.lat, 49.8);
  const pending = previewImport('name,address\nSynthetic,Synthetic Road 10\n', 'children', []);
  assert.equal(pending.pending, 1);
  assert.equal(pending.rows[0].data.lat, null);
  assert.throws(() => previewImport('name;seats;unknown\na;9;x', 'vehicles', []));
  assert.equal(previewImport('name;seats\nMTF;9\nMTF;3', 'vehicles', []).valid, false);
  assert.equal(previewImport('name;seats\nMTF;0', 'vehicles', []).valid, false);
  assert.equal(
    previewImport('name;address;lat;lon\nA;Synthetic Road;49;', 'children', []).valid,
    false,
  );
  assert.throws(() => previewImport('name;seats\n' + 'Vehicle;9\n'.repeat(501), 'vehicles', []));
});
test('CSV preview is read-only; imports are atomic, revision-protected, encrypted and roundtrip IDs', async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.setup();
  await f.login();
  await f.request('/api/station', 'PUT', point);
  const csv = 'name;address;lat;lon;confirmed\nSynthetic CSV;Synthetic CSV Road 10;49.8;8.7;true';
  const preview = await f.request('/api/csv/children/preview', 'POST', { csv });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.valid, true);
  assert.equal((await f.pool.query('SELECT * FROM children')).rowCount, 0);
  assert.equal(
    (await f.request('/api/csv/children/import', 'POST', { csv, revision: preview.data.revision }))
      .status,
    400,
  );
  assert.equal(
    (await f.request('/api/csv/children/import', 'POST', { csv, revision: 'old', confirmed: true }))
      .status,
    409,
  );
  const imported = await f.request('/api/csv/children/import', 'POST', {
    csv,
    revision: preview.data.revision,
    confirmed: true,
  });
  assert.equal(imported.data.creates, 1);
  assert.ok(
    !JSON.stringify((await f.pool.query('SELECT * FROM children')).rows).includes('Synthetic CSV'),
  );
  const exported = await f.request('/api/csv/children/export', 'POST', {});
  assert.match(exported.data, /Synthetic CSV/);
  assert.match(exported.headers.get('cache-control'), /no-store/);
  const repeat = await f.request('/api/csv/children/preview', 'POST', { csv: exported.data });
  assert.equal(repeat.data.updates, 1);
  assert.equal(repeat.data.creates, 0);
  const bad = 'name;seats\nValid Vehicle;9\nBad Vehicle;0';
  const revision = (await f.request('/api/data')).data.revision;
  assert.equal(
    (await f.request('/api/csv/vehicles/import', 'POST', { csv: bad, revision, confirmed: true }))
      .status,
    400,
  );
  assert.equal((await f.pool.query('SELECT * FROM vehicles')).rowCount, 0);
  const pendingCsv = 'name;address\nUnverified Synthetic;Unverified Synthetic Street 1';
  const importedPending = await f.request('/api/csv/children/import', 'POST', {
    csv: pendingCsv,
    revision,
    confirmed: true,
  });
  assert.equal(importedPending.data.pending, 1);
  const data = (await f.request('/api/data')).data;
  assert.equal(data.children.find((c) => c.name === 'Unverified Synthetic').confirmed, false);
  await f.request('/api/logout', 'POST', {});
  assert.equal((await f.request('/api/csv/children/export', 'POST', {})).status, 401);
});
