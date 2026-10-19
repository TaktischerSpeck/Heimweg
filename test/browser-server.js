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
};
const server = await createApp(pool, config, {
  geocode: async () => [{ address: 'Synthetic Test Road 10, Test Town', lat: 49.8, lon: 8.7 }],
  roadMatrix: async (_, points) => matrix(points.length - 1),
});
server.listen(3100, '127.0.0.1', () => console.log('Synthetic browser test server ready.'));
