# Karte je Fahrzeug

Jede berechnete Fahrzeugroute erhält eine eigene Karte mit tatsächlichem Straßenverlauf, Feuerwehrstandort und nummerierten Stopps. Die Adressliste und Ankunftszeiten bleiben erhalten. Die Karte lässt sich zoomen, verschieben und auf die gesamte Route zurücksetzen. Eine aktivierte Rückfahrt erscheint gestrichelt.

Karten werden unabhängig von der Optimierung geladen. Beim Variantenwechsel passen sie sich an die gewählte Variante an. Ein Kartenfehler lässt die Planung bestehen und bietet „Karte erneut laden“ an. Es gibt keine Ersatzlinie als vermeintlichen Straßenverlauf. Für veraltete Ergebnisse werden keine neuen Geometrien geladen.

## OSRM-LXC einmalig aktualisieren

Die bisherige nginx-Vorlage erlaubt nur Matrizen unter `/table/v1/driving/`. Zusätzlich muss für Fahrzeugkarten **`/route/v1/driving/`** zugelassen werden.

In der aktiven LXC-nginx-Konfiguration den Blockanfang:

```nginx
location /table/v1/driving/ {
```

ersetzen durch:

```nginx
location ~ "^/(table|route)/v1/driving/" {
```

Der restliche Block mit Proxy-Ziel, Authentifizierung, Zertifikat und IP-Freigaben bleibt bestehen. Beim Docker-LXC ist die aktive Datei `/etc/nginx/conf.d/osrm-local.conf`; die aktualisierte Vorlage liegt unter `deploy/osrm-docker/nginx-local.conf`.

Danach im LXC als Root:

```bash
nginx -t
systemctl reload nginx
```

Falls der äußere Reverse Proxy einzelne Pfade einschränkt, dort ebenfalls `/route/v1/driving/` wie den vorhandenen Table-Endpunkt an OSRM weiterleiten. Die Nominatim-Custom-Location `/search` bleibt unverändert. Der OSRM-Container und die aufbereiteten Karten benötigen keinen Neuimport.

Vom Plesk-Server mit synthetischen Testpunkten prüfen (Domain ersetzen):

```bash
curl --fail --show-error --user heimweg \
  'https://routing.example.org/route/v1/driving/8.748,49.83;8.749,49.831?geometries=geojson&overview=full'
```

Erwartet: `code: "Ok"` und eine LineString-Geometrie in `routes[0].geometry`. Nach App-Update und Neustart eine neue Planung berechnen. Bei OpenRouteService nutzt Heimweg die Directions-API; dafür gelten zusätzliche Anbieterlimits.

## Hintergrundkarte

Die Routengeometrie kommt über das Backend vom bereits konfigurierten Routingdienst. Zugangsdaten bleiben im Backend. Es gibt keine neuen JavaScript-Abhängigkeiten oder CDNs.

Standardmäßig wird ein **OpenStreetMap-Kartenhintergrund angeboten**, aber erst nach Klick auf „Kartenhintergrund laden“ angefragt. Die Oberfläche erklärt dabei, dass der externe Anbieter IP-Adresse und Kartenausschnitt erhält. Die Freigabe gilt bis zum Abmelden; ohne Freigabe bleiben Straßenverlauf und Stopps auf neutralem Hintergrund sichtbar. Namen, Adresslisten und Routengeometrien werden nicht in Kachel-URLs eingebaut.

Der Browser lädt nur sichtbare Kacheln mit seinem normalen HTTP-Cache und dem App-Origin als Referer. Es gibt keinen Offline-Download und kein Vorladen ganzer Gebiete. Die Attribution bleibt sichtbar. Die [OSM-Tile-Nutzungsbedingungen](https://operations.osmfoundation.org/policies/tiles/) beachten; der öffentliche Dienst bietet keine Verfügbarkeitsgarantie.

Für einen eigenen HTTPS-Kachelserver in der App-.env:

```dotenv
MAP_TILE_MODE=self-hosted
MAP_TILE_URL=https://tiles.example.org/{z}/{x}/{y}.png
MAP_TILE_ATTRIBUTION="© OpenStreetMap contributors"
```

Der Server muss 256-Pixel-Rasterkacheln im XYZ-/Web-Mercator-Schema liefern. Keine Zugangsdaten oder API-Schlüssel in die URL einbauen. Eigene Tiles benötigen keinen externen Freigabeklick. Für andere externe Anbieter `MAP_TILE_MODE=external` und deren URL/Attribution setzen; der Klick bleibt erforderlich.

Hintergrund vollständig deaktivieren:

```dotenv
MAP_TILE_MODE=disabled
```

Danach App neu starten. OSRM und Nominatim liefern selbst keine Kartenkacheln. Die Einstellung `PROVIDER_MODE` gilt weiterhin unabhängig davon für Routing und Adresssuche.

## Datenhaltung und Prüfung

Geometrien werden nicht in der Datenbank gespeichert. Der Browser hält sie nur für die aktuelle Planung im Arbeitsspeicher und verwirft sie bei neuer Berechnung oder Abmeldung. Kartenanfragen prüfen Anmeldung, CSRF-Schutz und die Stammdatenrevision.

Backend- und Browsertests prüfen mehrere Fahrzeugkarten, Stoppreihenfolge, GeoJSON, Rückfahrt, Zoom, ausbleibende Tile-Anfragen vor Freigabe sowie Providerfehler und Wiederholen. Die Freigabe des zusätzlichen OSRM-Endpunkts muss beim realen LXC-Deployment wie oben ergänzt werden.
