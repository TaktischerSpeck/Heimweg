import { ensure, HttpError } from './validation.js';

async function requestJson(url, options = {}) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
      headers: {
        'User-Agent': 'Heimweg/1.0 (self-hosted route planning)',
        Accept: 'application/json',
        ...options.headers,
      },
      ...(options.body ? { method: 'POST', body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok) throw new Error('Provider request failed.');
    return await response.json();
  } catch {
    // Never propagate upstream URLs, addresses or response bodies into logs or client errors.
    throw new HttpError(
      502,
      'Der Kartendienst ist nicht erreichbar oder hat eine ungültige Antwort geliefert.',
    );
  }
}
function available(config, type) {
  ensure(
    config.providerMode !== 'disabled' && config.services[type],
    'Der benötigte Kartendienst ist noch nicht konfiguriert. Bitte den Administrator kontaktieren.',
    503,
  );
}
export async function geocode(config, query) {
  available(config, 'geocoding');
  if (config.mapProvider === 'ors') {
    const url = new URL(`${config.services.geocoding}/geocode/search`);
    url.search = new URLSearchParams({ api_key: config.orsKey, text: query, size: '5' });
    const data = await requestJson(url);
    ensure(
      Array.isArray(data.features),
      'Die Adresssuche hat eine ungültige Antwort geliefert.',
      502,
    );
    return data.features
      .filter(
        (item) =>
          item.properties?.label &&
          Array.isArray(item.geometry?.coordinates) &&
          item.geometry.coordinates.length >= 2 &&
          item.geometry.coordinates.every(Number.isFinite),
      )
      .slice(0, 5)
      .map((item) => ({
        address: item.properties.label,
        lon: item.geometry.coordinates[0],
        lat: item.geometry.coordinates[1],
      }));
  }
  const url = new URL(`${config.services.geocoding}/search`);
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: '5', addressdetails: '1' });
  const data = await requestJson(url);
  ensure(Array.isArray(data), 'Die Adresssuche hat eine ungültige Antwort geliefert.', 502);
  return data
    .slice(0, 5)
    .filter(
      (item) =>
        Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && item.display_name,
    )
    .map((item) => ({ address: item.display_name, lat: Number(item.lat), lon: Number(item.lon) }));
}
export function validateMatrix(matrix, length) {
  for (const type of ['durations', 'distances']) {
    ensure(
      Array.isArray(matrix?.[type]) && matrix[type].length === length,
      'Ungültige Straßenmatrix.',
      502,
    );
    ensure(
      matrix[type].every(
        (row) =>
          Array.isArray(row) &&
          row.length === length &&
          row.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0),
      ),
      'Mindestens eine Adresse ist über das Straßennetz nicht erreichbar. Bitte die Adressen prüfen.',
      422,
    );
  }
  return matrix;
}
export async function roadMatrix(config, points) {
  available(config, 'routing');
  if (config.mapProvider === 'ors') {
    const result = await requestJson(new URL(`${config.services.routing}/v2/matrix/driving-car`), {
      headers: { Authorization: config.orsKey, 'Content-Type': 'application/json' },
      body: {
        locations: points.map((point) => [point.lon, point.lat]),
        metrics: ['duration', 'distance'],
        units: 'm',
      },
    });
    ensure(!result.error, 'Der Kartendienst konnte die Straßenmatrix nicht berechnen.', 422);
    ensure(
      [...(result.sources || []), ...(result.destinations || [])].every(
        (point) => typeof point?.snapped_distance !== 'number' || point.snapped_distance <= 500,
      ),
      'Eine Adresse liegt mehr als 500 Meter von einer befahrbaren Straße entfernt.',
      422,
    );
    return validateMatrix(result, points.length);
  }
  const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(';');
  const url = new URL(`${config.services.routing}/table/v1/driving/${coordinates}`);
  url.search = new URLSearchParams({
    annotations: 'duration,distance',
    radiuses: points.map(() => '500').join(';'),
  });
  const result = await requestJson(url);
  ensure(
    result.code === 'Ok',
    'Eine Adresse konnte keiner befahrbaren Straße zugeordnet werden. Bitte die Koordinaten prüfen.',
    422,
  );
  ensure(
    !result.fallback_speed_cells?.length,
    'Der Routingdienst hat geschätzte Luftlinienwerte geliefert. Die Berechnung wurde abgebrochen.',
    422,
  );
  return validateMatrix(result, points.length);
}
