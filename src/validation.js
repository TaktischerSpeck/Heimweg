export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensure(condition, message, status = 400) {
  if (!condition) throw new HttpError(status, message);
}
export function string(value, label, min = 1, max = 200) {
  ensure(
    typeof value === 'string' && value.trim().length >= min && value.trim().length <= max,
    `${label}: Bitte ${min} bis ${max} Zeichen eingeben.`,
  );
  return value.trim();
}
export function integer(value, label, min, max) {
  ensure(
    Number.isInteger(value) && value >= min && value <= max,
    `${label}: Bitte eine ganze Zahl zwischen ${min} und ${max} eingeben.`,
  );
  return value;
}
export function uuid(value) {
  ensure(
    typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value),
    'Ungültige Datensatz-ID.',
  );
  return value;
}
export function location(data) {
  ensure(data && typeof data === 'object', 'Adresse fehlt.');
  const address = string(data.address, 'Adresse', 5, 500);
  ensure(
    typeof data.lat === 'number' && Number.isFinite(data.lat) && Math.abs(data.lat) <= 90,
    'Ungültiger Breitengrad.',
  );
  ensure(
    typeof data.lon === 'number' && Number.isFinite(data.lon) && Math.abs(data.lon) <= 180,
    'Ungültiger Längengrad.',
  );
  ensure(data.confirmed === true, 'Bitte Adresse und Koordinaten prüfen und bestätigen.');
  return { address, lat: data.lat, lon: data.lon, confirmed: true };
}
