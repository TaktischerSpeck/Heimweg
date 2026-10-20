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
  const mapProvider = env.MAP_PROVIDER || 'osrm';
  if (!['osrm', 'ors'].includes(mapProvider)) throw new Error('Invalid MAP_PROVIDER.');
  for (const [name, variable] of [
    ['routing', 'OSRM_URL'],
    ['geocoding', 'NOMINATIM_URL'],
  ]) {
    const endpoint =
      mapProvider === 'ors'
        ? env.ORS_URL || 'https://api.openrouteservice.org'
        : env[variable] || '';
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
  const orsKey = secret(env, 'ORS_API_KEY');
  if (mapProvider === 'ors' && providerMode !== 'disabled' && !orsKey)
    throw new Error('ORS_API_KEY is required.');
  if (mapProvider === 'ors' && providerMode === 'self-hosted')
    throw new Error('ORS integration uses hosted geocoding; choose external mode.');
  const databaseEngine = env.DB_ENGINE || 'postgres';
  if (!['postgres', 'mariadb'].includes(databaseEngine)) throw new Error('Invalid DB_ENGINE.');
  const maria = databaseEngine === 'mariadb';
  const ssl = env.DB_SSL ?? (maria ? undefined : env.PGSSL);
  const ca = env.DB_SSL_CA_FILE ? readFileSync(env.DB_SSL_CA_FILE, 'utf8') : undefined;
  return {
    production,
    origin,
    encryptionKey,
    setupToken,
    services,
    providerMode,
    mapProvider,
    orsKey,
    databaseEngine,
    port: Number(env.PORT || 3000),
    host: env.HOST || '127.0.0.1',
    sessionMinutes: 30,
    // Trust only an explicitly configured direct reverse proxy, never arbitrary forwarding headers.
    trustedProxy: env.TRUSTED_PROXY_IP || '',
    database: {
      host: env.DB_HOST || (!maria && env.PGHOST) || 'localhost',
      port: Number(env.DB_PORT || (!maria && env.PGPORT) || (maria ? 3306 : 5432)),
      database: env.DB_NAME || (!maria && env.PGDATABASE) || 'heimweg',
      user: env.DB_USER || (!maria && env.PGUSER) || 'heimweg',
      password: secret(env, 'DB_PASSWORD') ?? (maria ? undefined : secret(env, 'PGPASSWORD')),
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      ssl: ssl === 'true' ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : false,
    },
  };
}
