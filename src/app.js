import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setup, login, session, rateLimit } from './auth.js';
import { cipher, digest, equal, hashPassword, token } from './security.js';
import { transaction, setting, bumpRevision } from './db.js';
import { HttpError, ensure, integer, location, string, uuid } from './validation.js';
import { geocode, roadMatrix, roadRoute } from './providers.js';
import { runOptimizer } from './planning.js';
import { exportCsv, previewImport } from './csv.js';

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/route-map.js': ['route-map.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};
async function bodyOf(request) {
  ensure(
    request.headers['content-type']?.split(';')[0] === 'application/json',
    'JSON-Anfrage erforderlich.',
    415,
  );
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    ensure(
      length <= (request.url?.startsWith('/api/csv/') ? 2 * 1024 * 1024 : 32768),
      'Die Anfrage ist zu groß.',
      413,
    );
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    ensure(body && typeof body === 'object' && !Array.isArray(body), 'Ungültige Anfrage.');
    return body;
  } catch {
    throw new HttpError(400, 'Ungültiges JSON.');
  }
}
export async function createApp(pool, config, dependencies = {}) {
  const crypt = cipher(config.encryptionKey);
  const dummyHash = await hashPassword(token());
  await setting(pool, 'encryption_check', crypt.encrypt('heimweg', 'encryption_check'));
  const check = await pool.query("SELECT value FROM settings WHERE key = 'encryption_check'");
  if (crypt.decrypt(check.rows[0].value, 'encryption_check') !== 'heimweg')
    throw new Error('Encryption key verification failed.');
  await setting(pool, 'revision', '0');
  const providers = { geocode, roadMatrix, roadRoute, optimize: runOptimizer, ...dependencies };
  let calculating = false;

  async function data(client = pool) {
    const settings = await client.query(
      "SELECT key, value FROM settings WHERE key IN ('station', 'revision')",
    );
    const station = settings.rows.find((row) => row.key === 'station');
    const children = (await client.query('SELECT * FROM children')).rows
      .map((row) => ({ id: row.id, ...crypt.decrypt(row.encrypted_data, `child:${row.id}`) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
    const vehicles = (await client.query('SELECT id, name, seats FROM vehicles ORDER BY name, id'))
      .rows;
    return {
      station: station ? crypt.decrypt(station.value, 'station') : null,
      children,
      vehicles,
      revision: settings.rows.find((row) => row.key === 'revision')?.value || '0',
    };
  }
  async function mutate(callback) {
    return transaction(pool, async (client) => {
      await client.query("SELECT value FROM settings WHERE key = 'revision' FOR UPDATE");
      const result = await callback(client);
      await bumpRevision(client);
      return result;
    });
  }
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' ${config.mapTiles?.origin || ''}; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    response.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    if (config.production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    const cookie = (value, expire = false) =>
      response.setHeader(
        'Set-Cookie',
        `heimweg=${value}; Path=/; HttpOnly; SameSite=Strict${config.production ? '; Secure' : ''}${expire ? '; Max-Age=0' : ''}`,
      );
    try {
      const pathname = new URL(request.url, config.origin).pathname;
      const method = request.method;
      if (method === 'GET' && pathname === '/healthz') {
        await pool.query('SELECT 1');
        return json(200, { status: 'ok' });
      }
      if (method === 'GET' && assets[pathname]) {
        const [file, type] = assets[pathname];
        response.writeHead(200, { 'Content-Type': type });
        return response.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
      }
      ensure(pathname.startsWith('/api/'), 'Nicht gefunden.', 404);
      const mutating = !['GET', 'HEAD'].includes(method);
      if (mutating)
        ensure(
          request.headers.origin === config.origin,
          'Die Anfrage stammt nicht von dieser Anwendung.',
          403,
        );
      const remote = request.socket.remoteAddress;
      const ip =
        config.trustedProxy && remote === config.trustedProxy
          ? request.headers['x-real-ip'] || remote
          : remote;
      if (method === 'GET' && pathname === '/api/status') {
        const users = await pool.query('SELECT id FROM users LIMIT 1');
        return json(200, { setupRequired: !users.rowCount });
      }
      if (method === 'POST' && pathname === '/api/setup') {
        await rateLimit(pool, `setup:${ip}`, 10);
        await setup(pool, config, await bodyOf(request));
        return json(201, { ok: true });
      }
      if (method === 'POST' && pathname === '/api/login') {
        await rateLimit(pool, `login:${ip}`);
        const result = await login(pool, await bodyOf(request), dummyHash, config.encryptionKey);
        cookie(result.sessionToken);
        return json(200, { csrfToken: result.csrfToken, username: result.username });
      }
      const userSession = await session(pool, request, config.encryptionKey);
      ensure(userSession, 'Bitte erneut anmelden.', 401);
      if (mutating)
        ensure(
          equal(digest(request.headers['x-csrf-token'] || ''), userSession.csrf_hash),
          'Die Sitzung muss neu geladen werden.',
          403,
        );
      if (method === 'GET' && pathname === '/api/session') {
        return json(200, { username: userSession.username, csrfToken: userSession.csrfToken });
      }
      if (method === 'POST' && pathname === '/api/logout') {
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [userSession.token_hash]);
        cookie('', true);
        return json(200, { ok: true });
      }
      if (method === 'GET' && pathname === '/api/data') {
        const snapshot = await transaction(
          pool,
          async (client) => {
            return data(client);
          },
          true,
        );
        return json(200, {
          ...snapshot,
          providers: {
            mapTiles: config.mapTiles || null,
            mode: config.providerMode,
            routing: Boolean(config.services.routing) && config.providerMode !== 'disabled',
            geocoding: Boolean(config.services.geocoding) && config.providerMode !== 'disabled',
          },
        });
      }
      if (method === 'POST' && pathname === '/api/geocode') {
        await rateLimit(pool, `geocode:${userSession.user_id}`, 30, 60);
        const body = await bodyOf(request);
        return json(200, {
          candidates: await providers.geocode(config, string(body.address, 'Adresse', 5, 500)),
        });
      }
      const csvMatch = pathname.match(/^\/api\/csv\/(children|vehicles)\/(export|preview|import)$/);
      if (csvMatch) {
        const [, type, operation] = csvMatch;
        if (operation === 'export' && method === 'POST') {
          const snapshot = await transaction(pool, (client) => data(client), true);
          response.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="heimweg-${type}.csv"`,
          });
          return response.end(exportCsv(type, snapshot[type]));
        }
        ensure(method === 'POST' && operation !== 'export', 'Nicht gefunden.', 404);
        await rateLimit(pool, `csv:${userSession.user_id}`, 20, 60);
        const body = await bodyOf(request);
        if (operation === 'preview') {
          const snapshot = await transaction(pool, (client) => data(client), true);
          return json(200, {
            ...previewImport(body.csv, type, snapshot[type]),
            revision: snapshot.revision,
          });
        }
        ensure(body.confirmed === true, 'Bitte die Importvorschau ausdrücklich bestätigen.');
        const imported = await mutate(async (client) => {
          const snapshot = await data(client);
          ensure(
            body.revision === snapshot.revision,
            'Die Stammdaten wurden geändert. Bitte die Vorschau neu laden.',
            409,
          );
          if (type === 'children')
            ensure(snapshot.station, 'Bitte zuerst den Feuerwehrstandort hinterlegen.');
          const preview = previewImport(body.csv, type, snapshot[type]);
          ensure(preview.valid, 'Der Import enthält Fehler. Bitte die Vorschau prüfen.');
          for (const row of preview.rows) {
            const { id, ...entry } = row.data;
            if (type === 'children') {
              const encrypted = crypt.encrypt(entry, `child:${id}`);
              await client.query(
                row.action === 'create'
                  ? 'INSERT INTO children(id, encrypted_data) VALUES ($1, $2)'
                  : 'UPDATE children SET encrypted_data = $2 WHERE id = $1',
                [id, encrypted],
              );
            } else
              await client.query(
                row.action === 'create'
                  ? 'INSERT INTO vehicles(id, name, seats) VALUES ($1, $2, $3)'
                  : 'UPDATE vehicles SET name = $2, seats = $3 WHERE id = $1',
                [id, entry.name, entry.seats],
              );
          }
          return { creates: preview.creates, updates: preview.updates, pending: preview.pending };
        });
        return json(200, imported);
      }
      if (method === 'PUT' && pathname === '/api/station') {
        const station = location(await bodyOf(request));
        await mutate((client) =>
          setting(client, 'station', crypt.encrypt(station, 'station'), true),
        );
        return json(200, { ok: true });
      }
      const childMatch = pathname.match(/^\/api\/children(?:\/([^/]+))?$/);
      if (childMatch && ['POST', 'PUT', 'DELETE'].includes(method)) {
        const id = childMatch[1] ? uuid(childMatch[1]) : randomUUID();
        ensure((method === 'POST') === !childMatch[1], 'Ungültiger Endpunkt.', 404);
        if (method === 'DELETE') {
          await mutate(async (client) => {
            const result = await client.query('DELETE FROM children WHERE id = $1', [id]);
            ensure(result.rowCount, 'Kind nicht gefunden.', 404);
          });
        } else {
          const body = await bodyOf(request);
          const child = { name: string(body.name, 'Name', 1, 120), ...location(body) };
          await mutate(async (client) => {
            ensure(
              (await client.query("SELECT key FROM settings WHERE key = 'station'")).rowCount,
              'Bitte zuerst den Feuerwehrstandort hinterlegen.',
            );
            const encrypted = crypt.encrypt(child, `child:${id}`);
            if (method === 'POST')
              await client.query('INSERT INTO children(id, encrypted_data) VALUES ($1, $2)', [
                id,
                encrypted,
              ]);
            else
              ensure(
                (
                  await client.query('UPDATE children SET encrypted_data = $2 WHERE id = $1', [
                    id,
                    encrypted,
                  ])
                ).rowCount,
                'Kind nicht gefunden.',
                404,
              );
          });
        }
        return json(method === 'POST' ? 201 : 200, { ok: true });
      }
      const vehicleMatch = pathname.match(/^\/api\/vehicles(?:\/([^/]+))?$/);
      if (vehicleMatch && ['POST', 'PUT', 'DELETE'].includes(method)) {
        const id = vehicleMatch[1] ? uuid(vehicleMatch[1]) : randomUUID();
        ensure((method === 'POST') === !vehicleMatch[1], 'Ungültiger Endpunkt.', 404);
        await mutate(async (client) => {
          if (method === 'DELETE')
            ensure(
              (await client.query('DELETE FROM vehicles WHERE id = $1', [id])).rowCount,
              'Fahrzeug nicht gefunden.',
              404,
            );
          else {
            const body = await bodyOf(request);
            const name = string(body.name, 'Bezeichnung', 1, 80),
              seats = integer(body.seats, 'Sitzplätze', 1, 100);
            if (method === 'POST')
              await client.query('INSERT INTO vehicles(id, name, seats) VALUES ($1, $2, $3)', [
                id,
                name,
                seats,
              ]);
            else
              ensure(
                (
                  await client.query('UPDATE vehicles SET name = $2, seats = $3 WHERE id = $1', [
                    id,
                    name,
                    seats,
                  ])
                ).rowCount,
                'Fahrzeug nicht gefunden.',
                404,
              );
          }
        });
        return json(method === 'POST' ? 201 : 200, { ok: true });
      }

      if (method === 'POST' && pathname === '/api/route-map') {
        await rateLimit(pool, `route-map:${userSession.user_id}`, 80, 60);
        const body = await bodyOf(request);
        ensure(
          Array.isArray(body.children) && body.children.length > 0 && body.children.length <= 40 &&
          new Set(body.children).size === body.children.length,
          'Bitte 1 bis 40 unterschiedliche Routenstopps angeben.',
        );
        const snapshot = await transaction(pool, client => data(client), true);
        ensure(snapshot.station, 'Bitte zuerst den Feuerwehrstandort hinterlegen.');
        ensure(body.revision === snapshot.revision, 'Die Route ist veraltet. Bitte neu berechnen.', 409);
        ensure(snapshot.vehicles.some(v => v.id === body.vehicleId), 'Fahrzeug nicht gefunden.', 404);
        const stops = body.children.map(id => {
          uuid(id);
          const child = snapshot.children.find(c => c.id === id);
          ensure(child && child.confirmed === true &&
            typeof child.lat === 'number' && typeof child.lon === 'number',
            'Eine Routenadresse fehlt oder ist noch nicht geprüft.', 409);
          return child;
        });
        const geometry = await providers.roadRoute(config, [snapshot.station, ...stops]);
        const returnGeometry = body.includeReturn === true
          ? await providers.roadRoute(config, [stops.at(-1), snapshot.station]) : null;
        const latestRevision = await pool.query("SELECT value FROM settings WHERE key = 'revision'");
        ensure(latestRevision.rows[0].value === snapshot.revision,
          'Die Stammdaten wurden geändert. Bitte neu berechnen.', 409);
        ensure(await session(pool, request, config.encryptionKey), 'Bitte erneut anmelden.', 401);
        return json(200, { geometry, returnGeometry, revision: snapshot.revision });
      }

      if (method === 'POST' && pathname === '/api/plan') {
        await rateLimit(pool, `plan:${userSession.user_id}`, 10, 60);
        ensure(!calculating, 'Eine Berechnung läuft bereits. Bitte kurz warten.', 409);
        const body = await bodyOf(request);
        ensure(
          Array.isArray(body.children) &&
            body.children.length > 0 &&
            body.children.length <= 40 &&
            new Set(body.children).size === body.children.length,
          'Bitte 1 bis 40 unterschiedliche Kinder auswählen.',
        );
        ensure(
          Array.isArray(body.vehicles) &&
            body.vehicles.length > 0 &&
            body.vehicles.length <= 8 &&
            new Set(body.vehicles.map((v) => v.id)).size === body.vehicles.length,
          'Bitte 1 bis 8 unterschiedliche Fahrzeuge auswählen.',
        );
        const seconds = integer(body.timeLimitSeconds ?? 10, 'Rechenzeit', 1, 30);
        const dwellSeconds = integer(body.dwellSeconds ?? 0, 'Ausstiegszeit', 0, 300);
        const departure = new Date(body.departure || Date.now());
        ensure(Number.isFinite(departure.getTime()), 'Ungültige Abfahrtszeit.');
        calculating = true;
        try {
          const snapshot = await transaction(
            pool,
            async (client) => {
              return data(client);
            },
            true,
          );
          ensure(snapshot.station, 'Bitte zuerst den Feuerwehrstandort hinterlegen.');
          ensure(
            body.revision === snapshot.revision,
            'Die Stammdaten wurden geändert. Bitte die Seite neu laden.',
            409,
          );
          const children = snapshot.children.filter((child) => body.children.includes(child.id));
          ensure(
            children.length === body.children.length,
            'Ein ausgewähltes Kind ist nicht mehr vorhanden.',
            409,
          );
          ensure(
            children.every(
              (child) =>
                child.confirmed === true &&
                typeof child.lat === 'number' &&
                typeof child.lon === 'number',
            ),
            'Mindestens eine Kinderadresse ist noch nicht geprüft. Bitte zuerst in der Kinderverwaltung bestätigen.',
          );
          const fleet = body.vehicles
            .map((selected) => {
              const vehicle = snapshot.vehicles.find((v) => v.id === selected.id);
              ensure(vehicle, 'Ein Fahrzeug ist nicht mehr vorhanden.', 409);
              const supervisors = integer(selected.supervisors, 'Betreuer', 1, 2);
              ensure(
                vehicle.seats > supervisors,
                `Das Fahrzeug ${vehicle.name} hat keine Kinderplätze.`,
              );
              return { ...vehicle, supervisors };
            })
            .sort((a, b) => a.id.localeCompare(b.id));
          const capacity = fleet.reduce(
            (total, vehicle) => total + vehicle.seats - vehicle.supervisors,
            0,
          );
          ensure(
            capacity >= children.length,
            `Es fehlen ${children.length - capacity} Kinderplätze.`,
          );
          const matrix = await providers.roadMatrix(config, [snapshot.station, ...children]);
          const result = await providers.optimize(
            { children, fleet, matrix, dwellSeconds },
            seconds,
          );
          const revision = await pool.query("SELECT value FROM settings WHERE key = 'revision'");
          ensure(
            revision.rows[0].value === snapshot.revision,
            'Die Stammdaten wurden während der Berechnung geändert. Bitte neu laden und erneut berechnen.',
            409,
          );
          ensure(
            await session(pool, request, config.encryptionKey),
            'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
            401,
          );
          return json(200, {
            ...result,
            station: snapshot.station,
            revision: snapshot.revision,
            departure: departure.toISOString(),
            dwellSeconds,
            includeReturn: body.includeReturn === true,
            calculatedAt: new Date().toISOString(),
          });
        } finally {
          calculating = false;
        }
      }
      throw new HttpError(404, 'Nicht gefunden.');
    } catch (error) {
      const duplicate = ['23505', 'ER_DUP_ENTRY'].includes(error.code);
      const status = error.status || (duplicate ? 409 : 500);
      const message = error.status
        ? error.message
        : duplicate
          ? 'Diese Bezeichnung ist bereits vergeben.'
          : 'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.';
      if (status >= 500)
        console.error(JSON.stringify({ event: 'request_failed', requestId, status }));
      if (!response.headersSent) json(status, { error: message, requestId });
      else response.end();
    }
  });
  server.requestTimeout = 65000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return server;
}
