const SVG = 'http://www.w3.org/2000/svg';
const active = new Set();
const cache = new Map();
let externalTilesAccepted = false;

export function project(lon, lat) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return [(lon + 180) / 360, (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2];
}
export function fitView(points, width, height) {
  const bounds = points.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]),
    Math.min(b[2], p[1]), Math.max(b[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);
  const [minX, maxX, minY, maxY] = bounds;
  const span = Math.max((maxX - minX) / Math.max(80, width - 80),
    (maxY - minY) / Math.max(80, height - 80), 1 / (256 * 2 ** 18));
  return { center: [(minX + maxX) / 2, (minY + maxY) / 2],
    zoom: Math.max(1, Math.min(18, Math.floor(Math.log2(1 / (256 * span))))) };
}
export function tilePlacements(center, zoom, width, height) {
  const count = 2 ** zoom, size = 256 * count;
  const left = center[0] * size - width / 2, top = center[1] * size - height / 2;
  const tiles = [];
  for (let x = Math.floor(left / 256); x <= Math.floor((left + width) / 256); x++) {
    for (let y = Math.floor(top / 256); y <= Math.floor((top + height) / 256); y++) {
      if (x >= 0 && y >= 0 && x < count && y < count)
        tiles.push({ x, y, z: zoom, left: x * 256 - left, top: y * 256 - top });
    }
  }
  return tiles;
}
function html(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function svg(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
export function disposeRouteMaps() {
  for (const instance of active) instance.destroy();
  active.clear();
}
export function resetRouteMaps({ logout = false } = {}) {
  disposeRouteMaps();
  cache.clear();
  if (logout) externalTilesAccepted = false;
}

function drawMap(host, route, station, data, tiles) {
  host.replaceChildren();
  const title = html('h4', 'route-map-title', 'Karte · ' + route.vehicle.name);
  const canvas = html('div', 'route-map-canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'region');
  canvas.setAttribute('aria-label', 'Karte für ' + route.vehicle.name + '. Pfeiltasten verschieben, Plus und Minus zoomen.');
  const background = html('div', 'route-map-tiles');
  background.setAttribute('aria-hidden', 'true');
  const vector = svg('svg', { role: 'img', 'aria-label': 'Straßenroute mit Feuerwehr und ' + route.stops.length + ' nummerierten Stopps' });
  const controls = html('div', 'route-map-controls');
  const note = html('p', 'route-map-note');
  note.setAttribute('role', 'status');
  const attribution = html('div', 'route-map-attribution');
  const osm = html('a', '', '© OpenStreetMap contributors');
  osm.href = 'https://www.openstreetmap.org/copyright';
  osm.target = '_blank';
  osm.rel = 'noopener noreferrer';
  attribution.append(osm);
  if (tiles && tiles.attribution !== '© OpenStreetMap contributors')
    attribution.append(document.createTextNode(' · ' + tiles.attribution));
  const linePoints = data.geometry.coordinates.map(([lon, lat]) => project(lon, lat));
  const returnPoints = (data.returnGeometry?.coordinates || []).map(([lon, lat]) => project(lon, lat));
  const markers = [{ ...station, label: '⌂', name: 'Feuerwehr' },
    ...route.stops.map((stop, i) => ({ ...stop, label: String(i + 1) }))];
  const projectedMarkers = markers.map(p => project(p.lon, p.lat));
  const all = [...linePoints, ...returnPoints, ...projectedMarkers];
  let width = host.clientWidth || 600, height = 320;
  let view = fitView(all, width, height), drag = null, disposed = false, tileError = false;
  const tileNodes = new Map();

  function redraw() {
    if (disposed) return;
    width = canvas.clientWidth || width;
    height = canvas.clientHeight || height;
    const size = 256 * 2 ** view.zoom;
    const position = p => [(p[0] - view.center[0]) * size + width / 2,
      (p[1] - view.center[1]) * size + height / 2];
    vector.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    vector.replaceChildren();
    function line(points, className) {
      if (!points.length) return;
      vector.append(svg('polyline', {
        points: points.map(p => position(p).join(',')).join(' '), class: className,
        fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      }));
    }
    line(linePoints, 'map-route-halo');
    line(linePoints, 'map-route-line');
    line(returnPoints, 'map-return-line');
    markers.forEach((marker, i) => {
      const [x, y] = position(projectedMarkers[i]);
      const group = svg('g', { class: i === 0 ? 'map-station-marker' : 'map-stop-marker',
        transform: 'translate(' + x + ' ' + y + ')', 'data-map-stop': i });
      group.append(svg('title', {}, marker.label + ' · ' + marker.name + ' · ' + marker.address));
      group.append(svg('circle', { r: i === 0 ? 16 : 14 }));
      group.append(svg('text', { 'text-anchor': 'middle', dy: '.35em' }, marker.label));
      vector.append(group);
    });
    const showTiles = tiles && (!tiles.external || externalTilesAccepted);
    const wanted = new Set();
    if (showTiles) for (const tile of tilePlacements(view.center, view.zoom, width, height)) {
      const key = [tile.z, tile.x, tile.y].join('/');
      wanted.add(key);
      let img = tileNodes.get(key);
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        img.width = 256;
        img.height = 256;
        img.draggable = false;
        img.referrerPolicy = 'strict-origin-when-cross-origin';
        img.addEventListener('error', () => {
          tileError = true;
          note.textContent = 'Der Kartenhintergrund ist nicht erreichbar. Straßenverlauf und Stopps bleiben sichtbar.';
        });
        img.src = tiles.url.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
        tileNodes.set(key, img);
        background.append(img);
      }
      img.style.left = tile.left + 'px';
      img.style.top = tile.top + 'px';
    }
    for (const [key, img] of tileNodes) if (!wanted.has(key)) {
      img.remove();
      tileNodes.delete(key);
    }
    if (!tileError) note.textContent = showTiles
      ? 'Durchziehen zum Verschieben · + / − zum Zoomen'
      : tiles ? 'Straßenverlauf und Stopps sind bereits sichtbar. Den Kartenhintergrund kannst du zusätzlich laden.'
        : 'Straßenverlauf und Stopps · Kartenhintergrund deaktiviert';
    const consent = host.querySelector('.route-map-consent');
    if (consent) consent.hidden = Boolean(showTiles);
  }
  function zoom(delta) {
    view.zoom = Math.max(1, Math.min(18, view.zoom + delta));
    redraw();
  }
  for (const [label, text, action] of [
    ['Karte vergrößern', '+', () => zoom(1)],
    ['Karte verkleinern', '−', () => zoom(-1)],
    ['Gesamte Route anzeigen', '↔', () => { view = fitView(all, width, height); redraw(); }],
  ]) {
    const button = html('button', '', text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', action);
    controls.append(button);
  }
  canvas.append(background, vector, controls, attribution);
  host.append(title, canvas);
  const legend = html('p', 'route-map-legend', '⌂ Feuerwehr · Zahlen = Reihenfolge der Stopps' +
    (returnPoints.length ? ' · gestrichelt = Rückfahrt' : ''));
  host.append(legend, note);
  if (tiles?.external) {
    const consent = html('div', 'route-map-consent');
    const button = html('button', '', 'Kartenhintergrund laden');
    button.type = 'button';
    button.addEventListener('click', () => {
      externalTilesAccepted = true;
      for (const instance of active) instance.redraw?.();
    });
    consent.append(button, html('p', 'small muted',
      'Lädt Kartenkacheln von ' + new URL(tiles.url.replaceAll('{z}', '0').replaceAll('{x}', '0').replaceAll('{y}', '0')).hostname +
      '. Dabei werden IP-Adresse und Kartenausschnitt übertragen. Die Freigabe gilt bis zum Abmelden.'));
    host.append(consent);
  }
  canvas.addEventListener('pointerdown', event => {
    if (event.target.closest('button, a') || (event.button !== undefined && event.button !== 0)) return;
    drag = { x: event.clientX, y: event.clientY, center: [...view.center] };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const size = 256 * 2 ** view.zoom;
    view.center = [Math.max(0, Math.min(1, drag.center[0] - (event.clientX - drag.x) / size)),
      Math.max(0, Math.min(1, drag.center[1] - (event.clientY - drag.y) / size))];
    redraw();
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('lostpointercapture', endDrag);
  canvas.addEventListener('keydown', event => {
    if (event.target.closest('button, a')) return;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key], size = 256 * 2 ** view.zoom;
      view.center = [Math.max(0, Math.min(1, view.center[0] + dx * 80 / size)),
        Math.max(0, Math.min(1, view.center[1] + dy * 80 / size))];
      redraw();
      event.preventDefault();
    } else if (['+', '=', '-'].includes(event.key)) {
      zoom(event.key === '-' ? -1 : 1);
      event.preventDefault();
    }
  });
  const observer = new ResizeObserver(redraw);
  observer.observe(canvas);
  const instance = { redraw, destroy() {
    disposed = true;
    observer.disconnect();
    for (const img of tileNodes.values()) img.removeAttribute('src');
    tileNodes.clear();
  } };
  active.add(instance);
  redraw();
}
export function mountRouteMaps({ root, plan, variant, stale, tiles, api }) {
  disposeRouteMaps();
  for (const host of root.querySelectorAll('[data-route-map]')) {
    const route = variant.routes[Number(host.dataset.routeMap)];
    if (!route) continue;
    const body = { vehicleId: route.vehicle.id, children: route.stops.map(s => s.id),
      revision: plan.revision, includeReturn: plan.includeReturn };
    const key = JSON.stringify(body);
    const draw = data => {
      if (host.isConnected) drawMap(host, route, plan.station, data, tiles);
    };
    if (cache.has(key)) { draw(cache.get(key)); continue; }
    const status = html('p', 'route-map-loading', stale
      ? 'Route veraltet – bitte vor dem Laden der Karte neu berechnen.' : 'Straßenkarte wird geladen …');
    status.setAttribute('role', 'status');
    host.replaceChildren(status);
    if (stale) continue;
    const controller = new AbortController();
    let cancelled = false;
    active.add({ destroy() { cancelled = true; controller.abort(); } });
    async function load() {
      status.textContent = 'Straßenkarte wird geladen …';
      try {
        const data = await api('/route-map', 'POST', body, controller.signal);
        if (cancelled || !host.isConnected) return;
        cache.set(key, data);
        draw(data);
      } catch (error) {
        if (cancelled || error.name === 'AbortError' || !host.isConnected) return;
        host.replaceChildren(html('p', 'route-map-error',
          'Karte nicht verfügbar: ' + error.message + ' Die berechnete Adressliste bleibt nutzbar.'));
        const retry = html('button', '', 'Karte erneut laden');
        retry.type = 'button';
        retry.addEventListener('click', () => {
          host.replaceChildren(status);
          void load();
        });
        host.append(retry);
      }
    }
    void load();
  }
}
