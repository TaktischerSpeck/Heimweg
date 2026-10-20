import { readFileSync } from 'node:fs';

function secret(env, name) {
  return env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`], 'utf8').trim() : env[name];
}
function providerCredentials(env, prefix, endpoint) {
  const username = env[`${prefix}_USERNAME`] || '';
  const password = secret(env, `${prefix}_PASSWORD`) || '';
  if (!username && !password) return null;
  if (
    !/^[A-Za-z0-9._@-]{1,128}$/.test(username) ||
    !password ||
    password.length > 1024 ||
    /[\r\n]/.test(password)
  )
    throw new Error(`Invalid ${prefix} authentication configuration.`);
  if (!endpoint || new URL(endpoint).protocol !== 'https:')
    throw new Error(`${prefix} password authentication requires an HTTPS endpoint.`);
  return { username, password };
}


export function getMapTiles(env = {}) {
  const mode = env.MAP_TILE_MODE || 'external';
  if (!['disabled', 'self-hosted', 'external'].includes(mode)) throw new Error('Invalid MAP_TILE_MODE.');
  if (mode === 'disabled') return null;
  const template = env.MAP_TILE_URL || (mode === 'external' ? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' : '');
  if (!template || !['{z}', '{x}', '{y}'].every(key => template.includes(key))) {
    throw new Error('MAP_TILE_URL must contain {z}, {x} and {y}.');
  }
  const url = new URL(template.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0'));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      /[\r\n]/.test(template) ||
      /[{}]/.test(template.replaceAll('{z}', '').replaceAll('{x}', '').replaceAll('{y}', ''))) {
    throw new Error('MAP_TILE_URL must be an HTTPS tile template without credentials or query strings.');
  }
  return {
    url: template,
    origin: url.origin,
    attribution: (env.MAP_TILE_ATTRIBUTION || '© OpenStreetMap contributors').slice(0, 300),
    external: mode === 'external',
    autoLoad: env.MAP_TILE_AUTO_LOAD === 'true',
  };
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
  const providerAuth = {
    routing: providerCredentials(env, 'OSRM', services.routing),
    geocoding: providerCredentials(env, 'NOMINATIM', services.geocoding),
  };
  if (mapProvider !== 'osrm' && (providerAuth.routing || providerAuth.geocoding))
    throw new Error('OSRM/NOMINATIM credentials require MAP_PROVIDER=osrm.');
  const databaseEngine = env.DB_ENGINE || 'postgres';
  if (!['postgres', 'mariadb'].includes(databaseEngine)) throw new Error('Invalid DB_ENGINE.');
  const maria = databaseEngine === 'mariadb';
  const ssl = env.DB_SSL ?? (maria ? undefined : env.PGSSL);
  const ca = env.DB_SSL_CA_FILE ? readFileSync(env.DB_SSL_CA_FILE, 'utf8') : undefined;
  return {
    production,
    mapTiles: getMapTiles(env),
    origin,
    encryptionKey,
    setupToken,
    services,
    providerAuth,
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
