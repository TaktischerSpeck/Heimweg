import { readFileSync } from 'node:fs';

function secret(env, name) {
  return env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`], 'utf8').trim() : env[name];
}

export function getConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const origin = env.APP_ORIGIN || 'http://localhost:3000';
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:')) {
    throw new Error('APP_ORIGIN must be an exact origin; production requires HTTPS.');
  }
  const encryptionKey = secret(env, 'ENCRYPTION_KEY');
  if (!/^[a-f\d]{64}$/i.test(encryptionKey || ''))
    throw new Error('ENCRYPTION_KEY must contain 64 hexadecimal characters.');
  const setupToken = secret(env, 'SETUP_TOKEN');
  if (!setupToken || setupToken.length < 32)
    throw new Error('SETUP_TOKEN must contain at least 32 characters.');
  const services = {};
  for (const [name, variable] of [
    ['routing', 'OSRM_URL'],
    ['geocoding', 'NOMINATIM_URL'],
  ]) {
    const endpoint = env[variable] || '';
    if (endpoint) {
      const url = new URL(endpoint);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(`Invalid ${variable}.`);
    }
    services[name] = endpoint.replace(/\/$/, '');
  }
  const providerMode = env.PROVIDER_MODE || 'disabled';
  if (!['disabled', 'self-hosted', 'external'].includes(providerMode))
    throw new Error('Invalid PROVIDER_MODE.');
  if (providerMode === 'external' && env.ALLOW_EXTERNAL_LOCATION_DATA !== 'true')
    throw new Error('External providers require explicit approval.');
  return {
    production,
    origin,
    encryptionKey,
    setupToken,
    services,
    providerMode,
    port: Number(env.PORT || 3000),
    sessionMinutes: 30,
    // Trust only an explicitly configured direct reverse proxy, never arbitrary forwarding headers.
    trustedProxy: env.TRUSTED_PROXY_IP || '',
    database: {
      host: env.PGHOST || 'localhost',
      port: Number(env.PGPORT || 5432),
      database: env.PGDATABASE || 'heimweg',
      user: env.PGUSER || 'heimweg',
      password: secret(env, 'PGPASSWORD'),
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      ssl: env.PGSSL === 'true' ? { rejectUnauthorized: true } : false,
    },
  };
}
