const root = document.querySelector('#app');
const dialog = document.querySelector('#editor');
const notice = document.querySelector('#notice');
let csrf = '',
  user = '',
  currentTab = 'plan',
  snapshot = null,
  result = null,
  selectedVariant = null,
  stale = false,
  busy = false,
  search = '',
  idleTimer,
  noticeTimer;
let selectedChildren = new Set(),
  selectedVehicles = new Map();
const options = { timeLimitSeconds: 10, dwellSeconds: 0, includeReturn: false, departure: '' };
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const minutes = (seconds) => (seconds / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const km = (meters) => (meters / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 });
const time = (seconds) =>
  new Date(new Date(result.departure).getTime() + seconds * 1000).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
const initials = (name) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
function toast(message) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.hidden = true;
  }, 6500);
}
function clearPrivate() {
  clearTimeout(idleTimer);
  csrf = '';
  user = '';
  snapshot = null;
  result = null;
  selectedChildren.clear();
  selectedVehicles.clear();
  search = '';
  stale = false;
  if (dialog.open) dialog.close();
  dialog.replaceChildren();
}
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (response.status === 401 && path !== '/login') {
    clearPrivate();
    renderAuth(false);
  }
  if (!response.ok) throw new Error(data.error || 'Die Anfrage ist fehlgeschlagen.');
  if (csrf) {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => {
        clearPrivate();
        renderAuth(false);
        toast('Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
      },
      30 * 60 * 1000,
    );
  }
  return data;
}
async function initialize() {
  try {
    const status = await api('/status');
    if (status.setupRequired) return renderAuth(true);
    try {
      const session = await api('/session');
      csrf = session.csrfToken;
      user = session.username;
      await reload();
    } catch {
      renderAuth(false);
    }
  } catch {
    root.innerHTML =
      '<div class="loading"><div><h2>Heimweg ist gerade nicht erreichbar.</h2><p>Bitte die Verbindung prüfen und die Seite neu laden.</p><button data-action="retry">Erneut versuchen</button></div></div>';
  }
}
function renderAuth(setup) {
  root.innerHTML = `<div class="auth"><section class="auth-story"><div class="brand"><img src="/icon.svg" alt=""><div>Heimweg<small>Für die Jugendfeuerwehr</small></div></div><h1>Gemeinsam los.<br><em>Alle gut zu Hause.</em></h1><p>Weniger planen, besser ankommen. Die passenden Fahrzeuge und Wege für euren Dienstabend.</p><div class="auth-path" aria-hidden="true"><span>⌂</span><span></span><span>⌂</span></div></section><main class="auth-form-area"><form class="auth-card" id="auth-form" data-setup="${setup}"><div class="eyebrow">${setup ? 'Ein guter Anfang' : 'Willkommen zurück'}</div><h2>${setup ? 'Heimweg einrichten' : 'Schön, dass du da bist.'}</h2><p>${setup ? 'Erstelle euer Administratorkonto. Kinder und Fahrzeuge legt ihr anschließend selbst an.' : 'Melde dich an, um die Heimfahrten für euren nächsten Dienst zu planen.'}</p>${setup ? '<label class="field">Einrichtungstoken<input name="setupToken" type="password" required autocomplete="off" minlength="32"></label>' : ''}<label class="field">Benutzername<input name="username" required autocomplete="username" maxlength="80" minlength="${setup ? 3 : 1}"></label><label class="field">Passwort<input name="password" type="password" required autocomplete="${setup ? 'new-password' : 'current-password'}" minlength="${setup ? 12 : 1}" maxlength="128"></label>${setup ? '<label class="field">Passwort wiederholen<input name="passwordRepeat" type="password" required autocomplete="new-password" minlength="12" maxlength="128"></label>' : ''}<p class="form-error" id="auth-error" role="alert"></p><button class="primary" type="submit">${setup ? 'Konto erstellen' : 'Anmelden'} <span aria-hidden="true">→</span></button><p class="auth-footnote">${setup ? 'Mindestens 12 Zeichen für dein Passwort. Den Einrichtungstoken erhältst du von eurem Serveradministrator.' : 'Nach drei falschen Passworteingaben wird das Konto dauerhaft gesperrt. Nur der Serveradministrator kann es wieder freigeben.'}</p></form></main></div>`;
}
async function reload() {
  snapshot = await api('/data');
  selectedChildren = new Set(
    [...selectedChildren].filter((id) => snapshot.children.some((c) => c.id === id)),
  );
  selectedVehicles = new Map(
    [...selectedVehicles].filter(([id]) => snapshot.vehicles.some((v) => v.id === id)),
  );
  render();
}
function render() {
  if (!snapshot) return;
  const labels = {
    plan: 'Tagesplanung',
    children: 'Kinder',
    vehicles: 'Fahrzeuge',
    station: 'Standort',
  };
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/icon.svg" alt=""><div>Heimweg<small>Jugendfeuerwehr</small></div></div><div class="nav-label">Organisation</div><nav aria-label="Hauptnavigation">${Object.entries(
    labels,
  )
    .map(
      ([key, label], i) =>
        `<button data-tab="${key}" class="${currentTab === key ? 'active' : ''}" ${currentTab === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${['◷', '♧', '▱', '⌂'][i]}</span>${label}</button>`,
    )
    .join(
      '',
    )}</nav><div class="sidebar-bottom"><div class="status"><span class="status-dot"></span>Gemeinsam gut ankommen</div><button data-action="logout" class="quiet">↪ Abmelden</button><div class="sidebar-note">Eine gute Planung.<br>Ein sicherer Heimweg.</div></div></aside><main class="workspace"><header class="topbar"><span>Jugendfeuerwehr <span aria-hidden="true"> / </span> <strong>${labels[currentTab]}</strong></span><span>${esc(user)}<span class="user-avatar">${esc(initials(user))}</span><button class="quiet" data-action="logout">Abmelden</button></span></header><div id="page">${currentTab === 'plan' ? planPage() : managePage()}</div></main></div>`;
}
function empty(title, text, tab, label) {
  return `<div class="empty"><span class="empty-icon" aria-hidden="true">${tab === 'vehicles' ? '▱' : '⌂'}</span><strong>${title}</strong>${text}${tab ? `<br><button data-tab="${tab}">${label} →</button>` : ''}</div>`;
}
function validation() {
  if (!snapshot.station) return 'Bitte zuerst den Feuerwehrstandort hinterlegen.';
  if (!selectedChildren.size) return 'Wähle die Kinder aus, die heute nach Hause gefahren werden.';
  if (!selectedVehicles.size) return 'Aktiviere mindestens ein verfügbares Fahrzeug.';
  if (selectedChildren.size > 40 || selectedVehicles.size > 8)
    return 'Pro Planung sind bis zu 40 Kinder und 8 Fahrzeuge möglich.';
  if (
    snapshot.vehicles.some(
      (v) => selectedVehicles.has(v.id) && v.seats <= selectedVehicles.get(v.id),
    )
  )
    return 'Ein aktives Fahrzeug hat keine Kinderplätze. Bitte die Auswahl ändern.';
  const capacity = totalCapacity();
  if (capacity < selectedChildren.size)
    return `Es fehlen noch ${selectedChildren.size - capacity} Kinderplätze.`;
  if (!snapshot.providers.routing) return 'Der Straßenroutingdienst ist noch nicht eingerichtet.';
  return '';
}
function totalCapacity() {
  return snapshot.vehicles.reduce(
    (sum, v) =>
      sum + (selectedVehicles.has(v.id) ? Math.max(0, v.seats - selectedVehicles.get(v.id)) : 0),
    0,
  );
}
function childRows() {
  const children = snapshot.children.filter((c) =>
    `${c.name} ${c.address}`.toLowerCase().includes(search.toLowerCase()),
  );
  return children.length
    ? children
        .map(
          (c) =>
            `<label class="select-row"><input type="checkbox" data-child="${c.id}" ${selectedChildren.has(c.id) ? 'checked' : ''}><span class="initial">${esc(initials(c.name))}</span><span><strong>${esc(c.name)}</strong><span class="small">${esc(c.address)}</span></span></label>`,
        )
        .join('')
    : '<div class="empty">Keine passenden Kinder gefunden.</div>';
}
function vehicleCards() {
  return snapshot.vehicles
    .map((v) => {
      const active = selectedVehicles.has(v.id),
        supervisors = selectedVehicles.get(v.id) || 1;
      return `<div class="vehicle-card ${active ? 'selected' : ''}"><label class="vehicle-top"><span class="vehicle-visual" aria-hidden="true">▱</span><span><strong>${esc(v.name)}</strong><small>${v.seats} Sitzplätze insgesamt</small></span><input type="checkbox" data-vehicle="${v.id}" ${active ? 'checked' : ''} aria-label="${esc(v.name)} verfügbar"></label>${active ? `<div class="vehicle-bottom"><label>Besatzung <select data-supervisors="${v.id}" aria-label="Betreuer für ${esc(v.name)}"><option value="1" ${supervisors === 1 ? 'selected' : ''}>1 Betreuer</option><option value="2" ${supervisors === 2 ? 'selected' : ''}>2 Betreuer</option></select></label><span class="capacity-label">${Math.max(0, v.seats - supervisors)} Kinderplätze</span></div>` : ''}</div>`;
    })
    .join('');
}
function planPage() {
  const reason = validation(),
    capacity = totalCapacity();
  return `<div class="page-head"><div><div class="eyebrow">Euer Dienstabend, gut geplant</div><h1>Heute sicher nach Hause.</h1><p>Kinder auswählen. Fahrzeuge aktivieren. Gemeinsam losfahren.</p></div><span class="date-badge">${new Date().toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' })}</span></div><div class="steps"><span class="step"><b>1</b>Wer fährt mit?</span><span class="step"><b>2</b>Was steht bereit?</span><span class="step"><b>3</b>Beste Wege finden</span></div>${snapshot.providers.mode === 'external' ? '<div class="notice-inline">Externe Kartendienste sind freigegeben. Bei der Adresssuche werden Adressen und bei der Routenberechnung Koordinaten an die konfigurierten Anbieter übertragen.</div>' : ''}<div class="planning-grid ${busy ? 'busy' : ''}" aria-busy="${busy}"><section class="panel"><div class="panel-head"><div><h2>Wer ist heute dabei?</h2><p>Markiere die Kinder für die Heimfahrt.</p></div><span class="number-badge" id="child-count">${selectedChildren.size} ausgewählt</span></div>${snapshot.children.length ? `<div class="panel-body"><input class="search" id="child-search" type="search" placeholder="Name oder Adresse suchen …" aria-label="Kinder suchen" value="${esc(search)}"><div class="child-list" id="child-list">${childRows()}</div></div><div class="list-footer"><span>${snapshot.children.length} Kinder hinterlegt</span><button class="quiet" data-action="clear-selection">Auswahl leeren</button></div>` : empty('Hier beginnt eure Heimfahrt.', 'Lege zuerst die Kinder und ihre Heimfahradressen an.', 'children', 'Kinder verwalten')}</section><section class="panel"><div class="panel-head"><div><h2>Welche Fahrzeuge sind da?</h2><p>Der Fahrer zählt bereits als ein Betreuer.</p></div><span class="number-badge">${selectedVehicles.size} verfügbar</span></div><div class="panel-body">${snapshot.vehicles.length ? vehicleCards() : empty('Noch kein Fahrzeug hinterlegt.', 'Erfasse die Gesamtzahl der zugelassenen Sitzplätze.', 'vehicles', 'Fahrzeug anlegen')}<div class="summary-box"><span>Verfügbare Kinderplätze<br><span id="capacity-note" class="small ${capacity >= selectedChildren.size ? 'good' : 'bad'}">${capacity >= selectedChildren.size ? `${capacity - selectedChildren.size} Plätze frei` : `${selectedChildren.size - capacity} Plätze fehlen`}</span></span><strong id="capacity-total">${selectedChildren.size} / ${capacity}</strong></div><details class="options"><summary>Optionen für diese Heimfahrt</summary><div class="options-grid"><label>Abfahrt (leer = jetzt)<input type="datetime-local" data-option="departure" value="${esc(options.departure)}"></label><label>Rechenzeit<select data-option="timeLimitSeconds">${[5, 10, 20, 30].map((v) => `<option value="${v}" ${options.timeLimitSeconds === v ? 'selected' : ''}>${v} Sekunden</option>`).join('')}</select></label><label>Ausstiegszeit pro Kind<select data-option="dwellSeconds">${[0, 30, 60, 120].map((v) => `<option value="${v}" ${options.dwellSeconds === v ? 'selected' : ''}>${v} Sekunden</option>`).join('')}</select></label></div><label class="check-label"><input type="checkbox" data-option="includeReturn" ${options.includeReturn ? 'checked' : ''}>Rückfahrt zur Feuerwehr separat anzeigen</label></details><button class="primary calculate" data-action="calculate" id="calculate" ${reason || busy ? 'disabled' : ''}><span>${busy ? 'Straßenrouten werden berechnet …' : result ? 'Routen neu berechnen' : 'Heimfahrten berechnen'}</span><span aria-hidden="true">→</span></button><p class="validation" id="validation" role="status">${reason || 'Alles bereit. Jedes Kind erhält genau einen Platz.'}</p></div></section></div><div class="info-strip"><span class="symbol" aria-hidden="true">⌁</span><span><b>Früher zu Hause, sinnvoll verteilt.</b> Wir suchen zuerst die früheste Ankunft des letzten Kindes. Verfügbare Fahrzeuge können dabei ungenutzt bleiben. Die gesamte Fahrzeit vergleichen wir separat.</span></div><div id="results">${result ? resultView() : ''}</div>`;
}
function savings(value, percent) {
  return `${value < 0 ? '−' : '+'}${minutes(Math.abs(value))} Min.${percent === null ? '' : ` (${Math.abs(percent).toLocaleString('de-DE', { maximumFractionDigits: 0 })} %)`}`;
}
function resultView() {
  const variant = result.variants.find(
    (v) => v.count === (selectedVariant || result.bestCount) && v.computed,
  );
  return `<section class="results">${stale ? '<div class="notice-inline" role="status"><b>Diese Routen sind veraltet.</b> Die Auswahl oder Stammdaten wurden geändert. Bitte vor der Abfahrt neu berechnen.</div>' : ''}${result.timedOut ? '<div class="notice-inline">Die Rechenzeit ist abgelaufen. Angezeigt werden ausschließlich vollständig berechnete Varianten. Eine längere Rechenzeit kann bessere Ergebnisse liefern.</div>' : ''}<div class="result-heading"><div><div class="eyebrow">Eure Heimfahrten</div><h2>${variant.count === result.bestCount ? 'So kommt ihr gut nach Hause.' : `Variante mit ${variant.count} Fahrzeugen`}</h2></div><span class="tag">${variant.optimal ? 'Optimale Variante' : 'Beste gefundene Lösung'}</span></div><div class="metrics"><div class="metric"><span>Letztes Kind zu Hause</span><strong>${time(variant.latestArrival)} <small>Uhr</small></strong></div><div class="metric"><span>Heimbringzeit ab Abfahrt</span><strong>${minutes(variant.latestArrival)} <small>Min.</small></strong></div><div class="metric"><span>Summe aller Fahrzeiten</span><strong>${minutes(variant.totalDuration)} <small>Min.</small></strong></div><div class="metric"><span>Gesamte Fahrstrecke</span><strong>${km(variant.totalDistance)} <small>km</small></strong></div></div><section class="panel"><div class="panel-head"><div><h2>Was bringt ein weiteres Fahrzeug?</h2><p>Referenz: die berechnete Variante mit ${result.referenceCount} Fahrzeug${result.referenceCount === 1 ? '' : 'en'}.</p></div></div><div class="table-wrap"><table class="comparison"><thead><tr><th>Fahrzeuge</th><th>Letztes Kind</th><th>Fahrzeit gesamt</th><th>Strecke</th><th>Ersparnis Heimbringzeit</th><th>Ersparnis Fahrzeit gesamt</th><th>Variante</th></tr></thead><tbody>${result.variants.map((v) => (v.computed ? `<tr class="${v.count === result.bestCount ? 'recommended' : ''}"><td><b>${v.count}</b>${v.count === result.bestCount ? ' · empfohlen' : ''}</td><td>${minutes(v.latestArrival)} Min.</td><td>${minutes(v.totalDuration)} Min.</td><td>${km(v.totalDistance)} km</td><td>${v.count === result.referenceCount || !result.hasComparison ? 'Referenz' : savings(v.savings.latestSeconds, v.savings.latestPercent)}</td><td>${v.count === result.referenceCount || !result.hasComparison ? 'Referenz' : savings(v.savings.totalSeconds, v.savings.totalPercent)}</td><td><button data-variant="${v.count}" ${v.count === variant.count ? 'disabled' : ''}>${v.count === variant.count ? 'Ausgewählt' : 'Anzeigen'}</button></td></tr>` : `<tr><td>${v.count}</td><td colspan="6">${v.feasible ? 'In dieser Rechenzeit noch nicht berechnet.' : 'Nicht möglich: zu wenige Kinderplätze oder mehr Fahrzeuge als Kinder.'}</td></tr>`)).join('')}</tbody></table></div><p class="table-note">Mehr Fahrzeuge können die letzte Ankunft beschleunigen und zugleich mehr Gesamtfahrzeit verursachen. Ein Minus bei der Ersparnis bedeutet Mehraufwand. ${!result.hasComparison ? 'Es liegt keine weitere berechnete Variante vor; eine Ersparnis lässt sich deshalb nicht belegen. ' : ''}Fahrzeiten sind Straßenprognosen ohne Live-Verkehr. ${result.dwellSeconds ? `${result.dwellSeconds} Sekunden Ausstiegszeit je vorherigem Kind sind in der Heimbringzeit enthalten, nicht in der reinen Fahrzeit.` : 'Ausstiegszeiten sind nicht eingerechnet.'} Rückfahrten sind in diesen Kennzahlen nicht enthalten.</p></section><div class="route-grid">${variant.routes.map((route, i) => `<article class="panel route"><div class="route-head"><div><div class="route-number">Route ${String(i + 1).padStart(2, '0')}</div><h3>${esc(route.vehicle.name)}</h3></div><span class="number-badge">${route.stops.length} Kinder · ${route.vehicle.supervisors} Betreuer</span></div><p class="route-stats">${minutes(route.duration)} Min. bis zum letzten Kind · ${km(route.distance)} km</p><ol class="stop-list"><li><span class="stop-dot">⌂</span><div class="stop-content"><strong>Feuerwehr</strong><p>${esc(result.station.address)}</p></div><time>${time(0)}</time></li>${route.stops.map((stop, j) => `<li><span class="stop-dot">${j + 1}</span><div class="stop-content"><strong>${esc(stop.name)}</strong><p>${esc(stop.address)}</p></div><time>${time(stop.arrivalSeconds)}</time></li>`).join('')}</ol>${result.includeReturn ? `<div class="route-return">↩ Rückfahrt zur Feuerwehr: zusätzlich ${minutes(route.returnDuration)} Min. · ${km(route.returnDistance)} km${result.dwellSeconds ? ` · Abfahrt nach ${result.dwellSeconds} Sek. letztem Ausstieg` : ''}<br>Zurück gegen ${time(route.duration + result.dwellSeconds + route.returnDuration)} Uhr.</div>` : ''}</article>`).join('')}</div><p class="small muted">${variant.unusedVehicles.length ? `Nicht benötigt: ${variant.unusedVehicles.map((v) => esc(v.name)).join(', ')}.` : 'Alle ausgewählten Fahrzeuge werden eingesetzt.'} ${variant.routes.reduce((sum, route) => sum + route.stops.length, 0)} Kinder sind vollständig zugeordnet.</p></section>`;
}
function managePage() {
  if (currentTab === 'station')
    return `<div class="page-head"><div><div class="eyebrow">Der gemeinsame Startpunkt</div><h1>Hier geht’s los.</h1><p>Alle Heimfahrten beginnen an eurem Feuerwehrstandort.</p></div></div><section class="panel station-panel"><h2>Feuerwehrstandort</h2>${snapshot.station ? `<p>${esc(snapshot.station.address)}</p><p class="small">Geprüfte Koordinaten: ${snapshot.station.lat}, ${snapshot.station.lon}</p>` : '<p>Noch kein Standort hinterlegt. Bitte Adresse suchen, Koordinaten prüfen und bestätigen.</p>'}<button class="primary" data-edit="station">${snapshot.station ? 'Standort bearbeiten' : 'Standort festlegen'}</button></section><div class="info-strip"><span class="symbol">⌁</span><span>Kartendienste: <b>${{ disabled: 'Noch nicht freigegeben', 'self-hosted': 'Eigener Betrieb', external: 'Externe Anbieter freigegeben' }[snapshot.providers.mode]}</b>. Straßenrouting ${snapshot.providers.routing ? 'konfiguriert' : 'fehlt'}, Adresssuche ${snapshot.providers.geocoding ? 'konfiguriert' : 'fehlt'}. Die Konfiguration erfolgt durch den Serveradministrator. ${snapshot.providers.mode === 'external' ? 'Adresssuche überträgt Adressen, Routing überträgt Koordinaten an die konfigurierten Anbieter.' : 'Alternativ können überprüfte Koordinaten manuell eingetragen werden.'}</span></div>`;
  const isChildren = currentTab === 'children',
    entries = isChildren ? snapshot.children : snapshot.vehicles;
  return `<div class="page-head"><div><div class="eyebrow">${isChildren ? 'Einmal hinterlegen, immer bereit' : 'Platz für alle'}</div><h1>${isChildren ? 'Unsere Jugendfeuerwehr.' : 'Unser Fuhrpark.'}</h1><p>${isChildren ? 'Namen und geprüfte Heimfahradressen an einem Ort.' : 'Die Sitzplätze enthalten Fahrer und weitere Betreuer.'}</p></div><button class="primary" data-edit="${currentTab}">+ ${isChildren ? 'Kind' : 'Fahrzeug'} anlegen</button></div>${entries.length ? `<div class="manage-list">${entries.map((item) => `<article class="manage-row"><div><strong>${esc(item.name)}</strong><p>${isChildren ? esc(item.address) : `${item.seats} Sitzplätze insgesamt`}</p></div><div class="row-actions"><button data-edit="${currentTab}" data-id="${item.id}">Bearbeiten</button><button class="quiet danger" data-delete="${currentTab}" data-id="${item.id}">Löschen</button></div></article>`).join('')}</div>` : `<section class="panel">${empty(isChildren ? 'Noch keine Kinder angelegt.' : 'Noch keine Fahrzeuge angelegt.', isChildren ? 'Neue Kinder werden erst nach dem Anlegen für die Tagesplanung auswählbar.' : 'Hinterlege eure Fahrzeuge mit ihrer individuellen Sitzplatzanzahl.')}</section>`}`;
}
function markStale() {
  if (result) stale = true;
}
function updatePlanCounters() {
  const capacity = totalCapacity(),
    reason = validation();
  document.querySelector('#child-count').textContent = `${selectedChildren.size} ausgewählt`;
  document.querySelector('#capacity-total').textContent = `${selectedChildren.size} / ${capacity}`;
  const note = document.querySelector('#capacity-note');
  note.textContent =
    capacity >= selectedChildren.size
      ? `${capacity - selectedChildren.size} Plätze frei`
      : `${selectedChildren.size - capacity} Plätze fehlen`;
  note.className = `small ${capacity >= selectedChildren.size ? 'good' : 'bad'}`;
  document.querySelector('#calculate').disabled = Boolean(reason || busy);
  document.querySelector('#validation').textContent =
    reason || 'Alles bereit. Jedes Kind erhält genau einen Platz.';
  if (result) document.querySelector('#results').innerHTML = resultView();
}
function openEditor(type, id) {
  if (type === 'children' && !snapshot.station) {
    currentTab = 'station';
    render();
    toast('Bitte zuerst den Feuerwehrstandort hinterlegen.');
    return;
  }
  const item =
    type === 'station'
      ? snapshot.station || {}
      : snapshot[type].find((entry) => entry.id === id) || {};
  const title =
    type === 'station'
      ? 'Feuerwehrstandort'
      : `${type === 'children' ? 'Kind' : 'Fahrzeug'} ${id ? 'bearbeiten' : 'anlegen'}`;
  dialog.innerHTML = `<form id="edit-form" data-type="${type}" data-id="${id || ''}"><div class="dialog-head"><h2>${title}</h2><button class="quiet" type="button" data-action="close-dialog" aria-label="Schließen">×</button></div>${type !== 'station' ? `<label class="field">${type === 'children' ? 'Name des Kindes' : 'Fahrzeugbezeichnung'}<input name="name" value="${esc(item.name)}" required maxlength="${type === 'children' ? 120 : 80}" autocomplete="off"></label>` : ''}${type === 'vehicles' ? `<label class="field">Gesamtzahl der Sitzplätze<input type="number" name="seats" value="${item.seats || 9}" min="1" max="100" required></label><p class="form-help">Fahrer und weitere Betreuer sind darin enthalten. Die Besatzung wird für jede Tagesplanung neu festgelegt.</p>` : `<label class="field">${type === 'station' ? 'Adresse der Feuerwehr' : 'Heimfahradresse'}<span class="search-address"><input name="address" value="${esc(item.address)}" required minlength="5" maxlength="500" autocomplete="off" placeholder="Straße, Hausnummer, PLZ und Ort"><button type="button" data-action="geocode" ${snapshot.providers.geocoding ? '' : 'disabled'}>Adresse suchen</button></span></label><div class="candidates" id="candidates"></div><p class="form-help">${snapshot.providers.geocoding ? 'Wähle einen passenden Suchtreffer und prüfe Hausnummer und Ort. Die Koordinaten kannst du bei Bedarf korrigieren.' : 'Die Adresssuche ist noch nicht konfiguriert. Du kannst bereits überprüfte Koordinaten manuell eintragen.'}${snapshot.providers.mode === 'external' ? ' Die Suche sendet diese Adresse an den freigegebenen externen Geokodierungsanbieter.' : ''}</p><div class="form-grid"><label class="field">Breitengrad<input name="lat" type="number" step="any" min="-90" max="90" required value="${item.lat ?? ''}" placeholder="49.83…"></label><label class="field">Längengrad<input name="lon" type="number" step="any" min="-180" max="180" required value="${item.lon ?? ''}" placeholder="8.75…"></label></div><label class="check-label"><input name="confirmed" type="checkbox" required>Ich habe Adresse und Koordinaten geprüft. Der Punkt entspricht dem gewünschten Ausstiegs- bzw. Startort.</label>`}<p class="form-error" id="edit-error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="close-dialog">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>`;
  dialog.showModal();
}
root.addEventListener('submit', async (event) => {
  if (event.target.id !== 'auth-form') return;
  event.preventDefault();
  const form = event.target,
    button = form.querySelector('button[type=submit]'),
    data = Object.fromEntries(new FormData(form));
  button.disabled = true;
  try {
    if (form.dataset.setup === 'true') {
      if (data.password !== data.passwordRepeat)
        throw new Error('Die Passwörter stimmen nicht überein.');
      await api('/setup', 'POST', data);
      renderAuth(false);
      toast('Das Konto ist eingerichtet. Du kannst dich jetzt anmelden.');
    } else {
      const session = await api('/login', 'POST', data);
      csrf = session.csrfToken;
      user = session.username;
      await reload();
    }
  } catch (error) {
    form.querySelector('#auth-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
dialog.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target,
    type = form.dataset.type,
    id = form.dataset.id,
    values = Object.fromEntries(new FormData(form));
  if (
    (id || (type === 'station' && snapshot.station)) &&
    !confirm('Die Änderungen an diesem Datensatz speichern?')
  )
    return;
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const body =
      type === 'vehicles'
        ? { name: values.name, seats: Number(values.seats) }
        : {
            name: values.name,
            address: values.address,
            lat: Number(values.lat),
            lon: Number(values.lon),
            confirmed: values.confirmed === 'on',
          };
    await api(`/${type}${id ? `/${id}` : ''}`, type === 'station' || id ? 'PUT' : 'POST', body);
    markStale();
    result = null;
    dialog.close();
    dialog.replaceChildren();
    await reload();
    toast('Gespeichert.');
  } catch (error) {
    form.querySelector('#edit-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  try {
    if (button.dataset.tab) {
      currentTab = button.dataset.tab;
      render();
      return;
    }
    if (button.dataset.edit) {
      openEditor(button.dataset.edit, button.dataset.id);
      return;
    }
    if (button.dataset.delete) {
      const type = button.dataset.delete,
        item = snapshot[type].find((v) => v.id === button.dataset.id);
      if (
        !confirm(
          `${item.name} endgültig löschen? Die Daten stehen anschließend nicht mehr für Planungen zur Verfügung.`,
        )
      )
        return;
      await api(`/${type}/${item.id}`, 'DELETE');
      result = null;
      await reload();
      toast('Datensatz gelöscht.');
      return;
    }
    if (button.dataset.variant) {
      selectedVariant = Number(button.dataset.variant);
      document.querySelector('#results').innerHTML = resultView();
      return;
    }
    if (button.dataset.candidate) {
      const candidate = JSON.parse(button.dataset.candidate),
        form = dialog.querySelector('form');
      for (const key of ['address', 'lat', 'lon']) form.elements[key].value = candidate[key];
      form.elements.confirmed.checked = false;
      document.querySelector('#candidates').replaceChildren();
      return;
    }
    switch (button.dataset.action) {
      case 'retry':
        await initialize();
        break;
      case 'close-dialog':
        dialog.close();
        dialog.replaceChildren();
        break;
      case 'logout':
        await api('/logout', 'POST', {});
        clearPrivate();
        renderAuth(false);
        break;
      case 'clear-selection':
        selectedChildren.clear();
        markStale();
        render();
        break;
      case 'geocode': {
        const form = dialog.querySelector('form');
        button.disabled = true;
        document.querySelector('#edit-error').textContent = '';
        try {
          const response = await api('/geocode', 'POST', { address: form.elements.address.value });
          document.querySelector('#candidates').innerHTML = response.candidates.length
            ? response.candidates
                .map(
                  (candidate) =>
                    `<button type="button" data-candidate="${esc(JSON.stringify(candidate))}">${esc(candidate.address)}</button>`,
                )
                .join('')
            : '<p class="form-help">Keine passende Adresse gefunden. Bitte die Schreibweise prüfen oder geprüfte Koordinaten eintragen.</p>';
        } catch (error) {
          document.querySelector('#edit-error').textContent = error.message;
        } finally {
          button.disabled = false;
        }
        break;
      }
      case 'calculate': {
        if (validation()) return;
        busy = true;
        render();
        try {
          result = await api('/plan', 'POST', {
            children: [...selectedChildren],
            vehicles: [...selectedVehicles].map(([id, supervisors]) => ({ id, supervisors })),
            revision: snapshot.revision,
            ...options,
            departure: options.departure ? new Date(options.departure).toISOString() : undefined,
          });
          stale = false;
          selectedVariant = result.bestCount;
        } finally {
          busy = false;
          render();
        }
        document.querySelector('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
    }
  } catch (error) {
    toast(error.message);
  }
});
root.addEventListener('input', (event) => {
  if (event.target.id === 'child-search') {
    search = event.target.value;
    document.querySelector('#child-list').innerHTML = childRows();
  }
});
root.addEventListener('change', (event) => {
  const element = event.target;
  if (element.dataset.child) {
    element.checked
      ? selectedChildren.add(element.dataset.child)
      : selectedChildren.delete(element.dataset.child);
    markStale();
    updatePlanCounters();
  }
  if (element.dataset.vehicle) {
    element.checked
      ? selectedVehicles.set(element.dataset.vehicle, 1)
      : selectedVehicles.delete(element.dataset.vehicle);
    markStale();
    render();
  }
  if (element.dataset.supervisors) {
    selectedVehicles.set(element.dataset.supervisors, Number(element.value));
    markStale();
    render();
  }
  if (element.dataset.option) {
    options[element.dataset.option] =
      element.type === 'checkbox'
        ? element.checked
        : element.dataset.option === 'departure'
          ? element.value
          : Number(element.value);
    markStale();
    updatePlanCounters();
  }
});
dialog.addEventListener('input', (event) => {
  if (['address', 'lat', 'lon'].includes(event.target.name))
    dialog.querySelector('[name=confirmed]').checked = false;
});
window.addEventListener('pagehide', () => {
  clearPrivate();
  root.replaceChildren();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) initialize();
});
initialize();
