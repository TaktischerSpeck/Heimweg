import { getMapTiles } from '../src/config.js';
// Synthetic in-memory data and deterministic providers are restricted to this test server.
import { database, matrix } from './helpers.js';
import { createApp } from '../src/app.js';
const pool = await database();
const config = {
  encryptionKey: 'ab'.repeat(32),
  setupToken: 'synthetic-browser-setup-token-000000',
  origin: 'http://127.0.0.1:3100',
  production: false,
  services: { routing: 'http://synthetic', geocoding: 'http://synthetic' },
  providerMode: 'self-hosted',
  mapTiles: getMapTiles(),
};
const server = await createApp(pool, config, {
  geocode: async () => [{ address: 'Synthetic Test Road 10, Test Town', lat: 49.8, lon: 8.7 }],
  roadMatrix: async (_, points) => matrix(points.length - 1),
  roadRoute: async (_, points) => ({ type: 'LineString', coordinates: [
    [points[0].lon, points[0].lat], [points[0].lon + 0.004, points[0].lat + 0.002],
    ...points.slice(1).map(p => [p.lon, p.lat]),
  ] }),
});
server.listen(3100, '127.0.0.1', () => console.log('Synthetic browser test server ready.'));
