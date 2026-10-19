import { ensure, HttpError } from './validation.js';

async function requestJson(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
      headers: {
        'User-Agent': 'Heimweg/1.0 (self-hosted route planning)',
        Accept: 'application/json',
      },
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
