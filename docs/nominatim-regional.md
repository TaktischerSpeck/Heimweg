# Nominatim für Darmstadt-Dieburg und Darmstadt

Diese Anleitung ersetzt ausschließlich den Hessen-Import der [Nominatim-Anleitung](nominatim-lxc-docker.md). nginx, HTTPS auf LXC-Port 4433, HTTP-Passwort und Heimweg-Konfiguration bleiben bestehen. Kein VPS-Restore nötig. Die Befehle auf dem **LXC als root** ausführen, nicht auf Plesk.

Es werden die OSM-Verwaltungsgrenzen von **Darmstadt-Dieburg (Relation 62704)** und **Darmstadt (62581)** vereinigt und um **5 km** gepuffert. Darmstadt ist kreisfrei. Der Puffer berücksichtigt Adressen und Straßen nahe der Grenze. Nur dieser Ausschnitt wird importiert; Hessen dient vorübergehend als Quelldatei und wird nach dem Ausschneiden gelöscht. Der Ausschnitt bleibt durch die Quelldatei auf Hessen begrenzt. Vollständige Wege und Multipolygone können über die Puffergrenze hinausreichen. Das ist kein exakt an der Grenze abgeschnittener Datenbestand.

| Einstellung | Import | Normalbetrieb |
| --- | --- | --- |
| LXC während des Imports | 16 GB RAM, 16 verfügbare Kerne | nach Prüfung verkleinerbar |
| Container-RAM-Limit | 14 GiB | 3 GiB |
| Container-CPU-Limit | 16 | 2 |
| Import-Threads | 16 | 2 (bei fertiger DB kein Neuimport) |
| PostgreSQL shared_buffers | 2 GB | 256 MB |
| maintenance_work_mem | 256 MB je Wartungsoperation | 128 MB |
| work_mem | 16 MB je Operation | 8 MB |
| effective_cache_size | 8 GB (Planer-Schätzung, keine Reservierung) | 1 GB |

Die übrigen Ressourcen brauchen Betriebssystem, Docker, nginx und OSRM. Die 16 Threads können parallele Importphasen beschleunigen; einzelne Phasen und SSD-I/O skalieren nicht linear. Es gibt keine garantierte Importdauer. Der 3-GiB-Wert ist ein Startwert, kein gemessener Gesamtbedarf des LXC. OSRM braucht separat RAM.

## 1. Dateien holen und regionalen Ausschnitt erzeugen

Nach dem Merge in main:

```bash
bash <<'SETUP'
set -euo pipefail
apt update
apt install -y git curl openssl osmium-tool python3-shapely python3-pyproj
install -d -m 755 /opt/osrm
regional_checkout=$(mktemp -d)
trap 'rm -rf "$regional_checkout"' EXIT
git clone --depth 1 https://github.com/TaktischerSpeck/Heimweg.git "$regional_checkout/Heimweg"
for file in compose.nominatim.yaml compose.nominatim.regional.yaml compose.nominatim.import.yaml prepare-region.sh region-polygon.py compose.osrm.regional.yaml prepare-osrm-region.sh; do
  cp "$regional_checkout/Heimweg/deploy/osrm-docker/$file" "/opt/osrm/$file"
done
cd /opt/osrm
if [ ! -e nominatim.env ]; then
  docker pull mediagis/nominatim:5.3
  regional_digest=$(docker image inspect mediagis/nominatim:5.3 --format '{{index .RepoDigests 0}}')
  test -n "$regional_digest"
  umask 077
  printf 'NOMINATIM_IMAGE=%s\n' "$regional_digest" > nominatim.env
  printf 'NOMINATIM_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> nominatim.env
fi
chmod 600 nominatim.env
# Stop the current Hessen import to release CPU/RAM; its volume is retained.
docker compose --env-file nominatim.env -f compose.nominatim.yaml stop nominatim
bash prepare-region.sh
SETUP
```

Das Skript verweigert das Überschreiben einer vorhandenen `geocoding-data/region.osm.pbf`. Bei erneutem Aufruf nach erfolgreicher Vorbereitung direkt mit Abschnitt 2 fortfahren. Fehler beim Download oder beim Zusammenbauen der Grenzen brechen ab, statt einen unvollständigen Ausschnitt zu importieren. Es benötigt kurzzeitig Platz für Hessen und Ausschnitt gleichzeitig. OSM-Dateien enthalten keine Heimweg-Kinderadressen oder App-Secrets.

Optional lässt sich vor der ersten Vorbereitung der Puffer ändern: `REGION_BUFFER_METRES=2000 bash prepare-region.sh`. `0` verwendet die vereinigten Grenzen ohne Puffer. Größere Puffer benötigen mehr Daten und Platz. Standard sind 5000 Meter.

## 2. Mit 16 Threads importieren

```bash
cd /opt/osrm
docker compose --env-file nominatim.env \
  -f compose.nominatim.yaml -f compose.nominatim.regional.yaml \
  -f compose.nominatim.import.yaml config --quiet
docker compose --env-file nominatim.env \
  -f compose.nominatim.yaml -f compose.nominatim.regional.yaml \
  -f compose.nominatim.import.yaml up -d
docker compose --env-file nominatim.env \
  -f compose.nominatim.yaml -f compose.nominatim.regional.yaml \
  -f compose.nominatim.import.yaml logs --tail 20 -f nominatim
```

Die regionale Vorlage setzt `PBF_URL` ausdrücklich leer, auch wenn `nominatim.env` noch die Hessen-URL enthält. Importiert wird ausschließlich `/maps/region.osm.pbf`. Die schreibgeschützte Datei liegt außerhalb von `/nominatim`, damit das rekursive chown des Images nicht auf den Read-only-Mount zugreift.

Das neue Volume heißt **`heimweg-geocoding_nominatim-regional-data`**. Das alte **`heimweg-geocoding_nominatim-data`** wird weder eingebunden noch gelöscht. Die Portbindung bleibt `127.0.0.1:8081`; nginx/Proxy müssen nicht geändert werden.

Warten auf **`Nominatim is ready to accept requests`**. `Up` und fortlaufende Indexierungszeilen bedeuten noch keine fertige API. Währenddessen sind Connection Reset oder Proxy-502 möglich. Strg+C beendet nur die Loganzeige. Keine ungeschwärzten Logs mit Passwörtern veröffentlichen.

## 3. Auf sparsamen Betrieb umstellen

Erst nach erfolgreichem Import das Import-Override weglassen. Dasselbe regionale DB-Volume wird weiterverwendet:

```bash
cd /opt/osrm
docker compose --env-file nominatim.env \
  -f compose.nominatim.yaml -f compose.nominatim.regional.yaml up -d

curl --max-time 30 --fail --show-error --get 'http://127.0.0.1:8081/search' \
  --data-urlencode 'q=Ober-Ramstadt, Deutschland' \
  --data-urlencode 'format=jsonv2' --data-urlencode 'limit=1'
echo
docker stats --no-stream
df -h /opt/osrm
docker system df -v
```

Nach dem kurzen Neustart wird ein nicht leeres JSON-Array erwartet. Auch über den bestehenden öffentlichen `/search`-Endpunkt testen. Für neue Installationen jetzt TLS/Proxy/App nach [Nominatim-Anleitung, Abschnitt 4](nominatim-lxc-docker.md#4-passwort-und-https-auf-4433) einrichten. Im Proxy: Location-Typ `=`, Pfad `/search`, HTTPS auf LXC-IP und Port 4433. Die öffentliche Basis-URL bleibt ohne `/search`.

Für alle späteren Nominatim-Start-/Stop-/Log-Befehle **beide** Dateien verwenden: `-f compose.nominatim.yaml -f compose.nominatim.regional.yaml`. Nur die Basisdatei würde wieder das alte Hessen-Volume starten. Vor dem Verkleinern des LXC RAM und CPU über einige Suchanfragen beobachten und OSRM mit einrechnen. Die 3 GiB sind ein Containerlimit und keine Empfehlung, den gesamten LXC auf 3 GB zu verkleinern.

## 4. Alten Speicher freigeben und Rückfall

Das alte Hessen-Volume belegt weiterhin Platz. **Erst nach erfolgreichem regionalem Import und Suchtest** gezielt löschen:

```bash
docker volume inspect heimweg-geocoding_nominatim-data --format '{{.Name}}'
docker volume rm heimweg-geocoding_nominatim-data
```

Damit ist nur die alte Nominatim-Datenbank gelöscht. Kein `down -v` oder globales Volume-Pruning verwenden. Docker verweigert das Löschen, falls noch ein Container das Volume verwendet.

Solange es erhalten ist, kann mit `docker compose --env-file nominatim.env -f compose.nominatim.yaml up -d` auf Hessen zurückgeschaltet werden. Ein abgebrochener Hessen-Erstimport ist allerdings keine fertige Rückfall-Datenbank. Bei abgebrochenem regionalem Erstimport das regionale Volume erhalten und Ursache prüfen; nicht automatisch wiederholt löschen.

## 5. Auch OSRM verkleinern

Denselben Ausschnitt verwenden, nachdem der Nominatim-Import fertig ist. **Beide Importe nacheinander** ausführen, damit sie sich nicht jeweils 14 GiB RAM und 16 Kerne teilen müssen. Das Skript baut in einem neuen Verzeichnis mit dem vorhandenen gepinnten OSRM-Image; die laufenden Routingdaten bleiben erhalten.

```bash
cd /opt/osrm
bash prepare-osrm-region.sh
docker compose -f compose.yaml -f compose.osrm.regional.yaml config --quiet
docker compose -f compose.yaml -f compose.osrm.regional.yaml up -d
curl --max-time 30 --fail --show-error \
  'http://127.0.0.1:5000/route/v1/driving/8.748,49.83;8.749,49.831?geometries=geojson&overview=full'
echo
curl --max-time 30 --fail --show-error \
  'http://127.0.0.1:5000/table/v1/driving/8.748,49.83;8.749,49.831'
echo
docker stats --no-stream
```

Beide Aufrufe müssen `"code":"Ok"` liefern. Auch eine vollständige Heimweg-Berechnung mit mehreren örtlichen Adressen testen. Der Ausschnitt kann weiträumige Umfahrungen außerhalb des Puffers nicht abdecken. Für spätere OSRM-Starts beide Dateien verwenden: `-f compose.yaml -f compose.osrm.regional.yaml`. nginx und die öffentliche Routing-URL ändern sich nicht.

Rückfall auf den vorherigen Bestand: `docker compose -f compose.yaml up -d`. Erst nach erfolgreichen Tests und bei Bedarf nach Sicherung das alte Verzeichnis `/opt/osrm/data` gezielt entfernen, um dessen Plattenplatz freizugeben. `osrm-regional-data` enthält den neuen aktiven Bestand und muss bleiben. Ohne Löschen der alten Daten sinkt die Plattenbelegung zunächst nicht.

Automatische Updates bleiben deaktiviert. Eine neue PBF ersetzt keine importierte Datenbank. Für spätere Neuimporte neue Volumes und Dateipfade verwenden und anschließend umschalten. Die Quelldatei für reproduzierbare Neuimporte aufbewahren; sie wird nicht zusätzlich ins Image kopiert.

Quellen: [OSM-Grenzrelationen Hessen](https://wiki.openstreetmap.org/wiki/DE:Germany/Grenzen/Hessen), [Osmium extract](https://docs.osmcode.org/osmium/latest/osmium-extract.html), [Nominatim Docker-Parameter](https://github.com/mediagis/nominatim-docker/blob/master/howto.md). Regionale Daten: © OpenStreetMap contributors, ODbL.
