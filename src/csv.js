import { parse } from 'csv-parse/sync';
import { randomUUID } from 'node:crypto';
import { ensure, integer, string, uuid } from './validation.js';

const aliases = {
  id: 'id',
  name: 'name',
  adresse: 'address',
  address: 'address',
  lat: 'lat',
  breitengrad: 'lat',
  lon: 'lon',
  längengrad: 'lon',
  laengengrad: 'lon',
  confirmed: 'confirmed',
  geprüft: 'confirmed',
  geprueft: 'confirmed',
  seats: 'seats',
  sitzplätze: 'seats',
  sitzplaetze: 'seats',
  bezeichnung: 'name',
};
const normalize = (value) => String(value).trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
const unprotect = (value) =>
  value.startsWith("''") || /^'[\s\u0000-\u001f]*[=+@-]/.test(value) ? value.slice(1) : value;
const identity = (row, type) =>
  type === 'children' ? `${normalize(row.name)}\0${normalize(row.address)}` : normalize(row.name);

function table(csv) {
  ensure(
    typeof csv === 'string' && Buffer.byteLength(csv) <= 1024 * 1024,
    'Die CSV-Datei darf höchstens 1 MiB groß sein.',
  );
  const input = csv.replace(/^\uFEFF/, '');
  let records;
  for (const delimiter of [';', ',']) {
    try {
      const candidate = parse(input, {
        delimiter,
        bom: true,
        skip_empty_lines: true,
        max_record_size: 16384,
        trim: true,
      });
      if (candidate[0]?.length >= 2) {
        records = candidate;
        break;
      }
    } catch {
      /* Try the other supported delimiter without exposing parser input. */
    }
  }
  ensure(
    records?.length >= 2,
    'Die CSV-Datei benötigt eine Kopfzeile und mindestens einen Datensatz. Bitte Trennzeichen und Anführungszeichen prüfen.',
  );
  ensure(records.length <= 501, 'Pro Import sind höchstens 500 Datensätze erlaubt.');
  const headers = records.shift().map((header) => aliases[normalize(header)]);
  ensure(
    headers.every(Boolean) && new Set(headers).size === headers.length,
    'Die Kopfzeile enthält unbekannte oder doppelte Spalten.',
  );
  return { headers, records };
}
function number(value, label, min, max) {
  ensure(typeof value === 'string' && value.trim() !== '', `${label} fehlt.`);
  const result = Number(value.replace(',', '.'));
  ensure(Number.isFinite(result) && result >= min && result <= max, `${label} ist ungültig.`);
  return result;
}
export function previewImport(csv, type, existing) {
  ensure(['children', 'vehicles'].includes(type), 'Ungültiger CSV-Typ.');
  const { headers, records } = table(csv);
  const required = type === 'children' ? ['name', 'address'] : ['name', 'seats'];
  ensure(
    required.every((key) => headers.includes(key)),
    `Benötigte Spalten: ${required.join(', ')}.`,
  );
  const allowed =
    type === 'children'
      ? ['id', 'name', 'address', 'lat', 'lon', 'confirmed']
      : ['id', 'name', 'seats'];
  ensure(
    headers.every((key) => allowed.includes(key)),
    'Die Spalten passen nicht zum gewählten Importtyp.',
  );
  const usedIds = new Set(),
    usedIdentities = new Set();
  const rows = records.map((values, index) => {
    const line = index + 2;
    try {
      ensure(values.length === headers.length, 'Die Anzahl der Spalten stimmt nicht.');
      const raw = Object.fromEntries(
        headers.map((key, i) => [
          key,
          ['name', 'address'].includes(key) ? unprotect(values[i]) : values[i],
        ]),
      );
      const entry = { name: string(raw.name, 'Name', 1, type === 'children' ? 120 : 80) };
      if (type === 'vehicles')
        entry.seats = integer(number(raw.seats, 'Sitzplätze', 1, 100), 'Sitzplätze', 1, 100);
      else {
        entry.address = string(raw.address, 'Adresse', 5, 500);
        const hasLat = Boolean(raw.lat?.trim()),
          hasLon = Boolean(raw.lon?.trim());
        ensure(hasLat === hasLon, 'Breiten- und Längengrad müssen gemeinsam angegeben werden.');
        entry.lat = hasLat ? number(raw.lat, 'Breitengrad', -90, 90) : null;
        entry.lon = hasLon ? number(raw.lon, 'Längengrad', -180, 180) : null;
        const flag = normalize(raw.confirmed || 'false');
        ensure(
          ['true', 'false', '1', '0', 'ja', 'nein', 'yes', 'no'].includes(flag),
          'confirmed muss true oder false sein.',
        );
        entry.confirmed = hasLat && ['true', '1', 'ja', 'yes'].includes(flag);
      }
      const key = identity(entry, type);
      const matching = existing.filter((row) => identity(row, type) === key);
      ensure(
        matching.length <= 1 || raw.id,
        'Mehrdeutiger vorhandener Datensatz. Bitte die exportierte ID angeben.',
      );
      const id = raw.id ? uuid(raw.id.trim()) : matching[0]?.id || randomUUID();
      ensure(
        !usedIds.has(id) && !usedIdentities.has(key),
        'Doppelter Datensatz innerhalb der CSV-Datei.',
      );
      // Names of vehicles remain unique even when a CSV row supplies a different identifier.
      if (type === 'vehicles')
        ensure(
          !matching.some((row) => row.id !== id),
          'Die Fahrzeugbezeichnung ist bereits vergeben.',
        );
      usedIds.add(id);
      usedIdentities.add(key);
      return {
        line,
        action: existing.some((row) => row.id === id) ? 'update' : 'create',
        data: { id, ...entry },
      };
    } catch (error) {
      return { line, error: error.status ? error.message : 'Ungültiger Datensatz.' };
    }
  });
  return {
    rows,
    valid: rows.every((row) => !row.error),
    creates: rows.filter((row) => row.action === 'create').length,
    updates: rows.filter((row) => row.action === 'update').length,
    pending: rows.filter((row) => row.data && type === 'children' && !row.data.confirmed).length,
  };
}
function cell(value) {
  let text = String(value ?? '');
  // Prefix dangerous spreadsheet formula cells; import removes exactly this protective prefix.
  if (
    text.startsWith("'") ||
    (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text))
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function exportCsv(type, entries) {
  const columns =
    type === 'children'
      ? ['id', 'name', 'address', 'lat', 'lon', 'confirmed']
      : ['id', 'name', 'seats'];
  const lines = [columns, ...entries.map((entry) => columns.map((column) => entry[column]))];
  return '\uFEFF' + lines.map((line) => line.map(cell).join(';')).join('\r\n') + '\r\n';
}
