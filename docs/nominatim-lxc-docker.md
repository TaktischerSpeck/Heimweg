# Adresssuche: Nominatim zusätzlich im OSRM-LXC

Diese Ergänzung setzt den [OSRM-Docker-LXC mit lokalem TLS](osrm-lxc-docker.md) voraus. OSRM bleibt unverändert auf Port 443. Ein eigener Nominatim-Container enthält die Adressdatenbank; nginx im LXC veröffentlicht die Suche mit HTTPS und Basic Auth auf **4433**.

| Verbindung | Ziel |
| --- | --- |
| Routing | bestehender OSRM-Endpunkt auf LXC-Port 443 |
| Adresssuche | nginx im LXC, HTTPS-Port **4433** |
| Nominatim intern | `127.0.0.1:8081` → Container-Port 8080 |
| Nominatim-Datenbank | PostgreSQL im Container, kein veröffentlichter Datenbankport |

Der vorhandene äußere Reverse Proxy kann eine eigene Geocoding-Domain auf `https://LXC-IP:4433` weiterleiten. Dann spricht Heimweg diese Domain auf dem normalen HTTPS-Port 443 an. Soll stattdessen dieselbe äußere Domain mit `:4433` verwendet werden, muss auch der äußere Proxy einen öffentlichen TLS-Listener auf 4433 anbieten. LXC-Port und äußerer Port sind getrennte Einstellungen.

Alle Domains und IPs sind Platzhalter. Es wird nichts auf deinem tatsächlichen LXC automatisch installiert.

Für eine sparsame Installation im Raum Darmstadt-Dieburg zuerst die [regionale Einrichtung und Umstellung](nominatim-regional.md) verwenden. Sie ersetzt den Hessen-Import aus Abschnitt 3; TLS, Proxy und App-Konfiguration ab Abschnitt 4 gelten weiterhin.

## 1. Voraussetzungen

Nominatim benötigt einen eigenen OSM-Datenimport und zusätzlichen RAM-/SSD-Speicher. Für beide Dienste gemeinsam zunächst etwa 12–16 GB RAM und mindestens 60 GB SSD als Planungswert für Hessen vorsehen und den Import überwachen; dies sind keine garantierten Mindestwerte. Ein kleinerer passender Ausschnitt benötigt weniger; dafür gibt es die [regionale Vorlage](nominatim-regional.md) mit getrennten Import- und Betriebsprofilen. Während des Imports kann die Adresssuche noch nicht benutzt werden.

Verwendet wird das Community-Image **mediagis/nominatim:5.3**, dessen dokumentierter PostgreSQL-Datenpfad `/var/lib/postgresql/16/main` ist. Nominatim verwendet seine eigene PostgreSQL-Datenbank, nicht Heimwegs MariaDB. Der Container darf seine Daten nicht in ein bestehendes OSRM-Verzeichnis schreiben.

## 2. Zusätzliche Dateien kopieren und Image festhalten

Als Root im LXC, nach dem Merge der Ergänzung nach main:

```bash
bash <<'SETUP'
set -euo pipefail
apt update
apt install -y git openssl apache2-utils
install -d -m 755 /opt/osrm
nominatim_checkout=$(mktemp -d)
trap 'rm -rf "$nominatim_checkout"' EXIT
git clone --depth 1 https://github.com/TaktischerSpeck/Heimweg.git "$nominatim_checkout/Heimweg"
for file in compose.nominatim.yaml nginx-nominatim-local.conf nginx-nominatim-upstream.conf.example; do
  cp "$nominatim_checkout/Heimweg/deploy/osrm-docker/$file" "/opt/osrm/$file"
done
cd /opt/osrm
docker pull mediagis/nominatim:5.3
nominatim_digest=$(docker image inspect mediagis/nominatim:5.3 --format '{{index .RepoDigests 0}}')
test -n "$nominatim_digest"
if [ ! -e nominatim.env ]; then
  umask 077
  printf 'NOMINATIM_IMAGE=%s\n' "$nominatim_digest" > nominatim.env
  printf 'NOMINATIM_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" >> nominatim.env
  printf 'NOMINATIM_PBF_URL=https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf\n' >> nominatim.env
else
  echo 'Kept existing nominatim.env; review image upgrades separately.'
fi
chmod 600 nominatim.env
docker compose --env-file nominatim.env -f compose.nominatim.yaml config --quiet
SETUP
```

Die vorhandene OSRM-.env und compose.yaml werden nicht ersetzt. Nominatim hat einen eigenen Compose-Projektnamen und ein eigenes Volume. `nominatim.env` ist nur für Docker, nicht die Konfiguration der Heimweg-App.

`NOMINATIM_DB_PASSWORD` ist ein intern erzeugtes Datenbankpasswort. **Es ist nicht das HTTP-Servicepasswort** für Heimweg. Nicht in die App übernehmen und keine realen Env-/Inspect-Ausgaben veröffentlichen.

## 3. Import starten

```bash
cd /opt/osrm
docker compose --env-file nominatim.env -f compose.nominatim.yaml up -d
docker compose --env-file nominatim.env -f compose.nominatim.yaml ps
docker compose --env-file nominatim.env -f compose.nominatim.yaml logs --tail 50 -f nominatim
```

Der erste Start lädt den Hessen-Ausschnitt und importiert ihn. Erst nach erfolgreichem Import startet die API. Strg+C beendet nur die Loganzeige. Containerlogs können interne Datenbankdetails enthalten; nicht ungeprüft weitergeben. Bei Exit 137/OOM RAM prüfen; nach abgebrochenem Erstimport nicht ohne Prüfung weiterarbeiten. Ein Neuimport nur mit einem separaten, leeren Volume durchführen und vorhandene Daten erhalten.

Danach lokal prüfen:

```bash
curl --fail --show-error --get 'http://127.0.0.1:8081/search' \
  --data-urlencode 'q=Ober-Ramstadt, Deutschland' \
  --data-urlencode 'format=jsonv2' \
  --data-urlencode 'limit=1'
```

Erwartet: ein nicht leeres JSON-Array mit `display_name`, `lat` und `lon`. Ein leeres Array kann auf fehlende Kartenabdeckung hindeuten; ein Verbindungsfehler während des Imports ist noch kein fertig gestarteter Dienst.

## 4. Passwort und HTTPS auf 4433

Die bestehende interne Zertifikatsdatei für `osrm.internal` wird wiederverwendet. Ein Zertifikat ist nicht an einen Port gebunden.

```bash
test -f /etc/nginx/osrm-tls/server.crt
test -f /etc/nginx/osrm-tls/server.key
htpasswd -cB /etc/nginx/heimweg-nominatim.htpasswd heimweg
chown root:www-data /etc/nginx/heimweg-nominatim.htpasswd
chmod 640 /etc/nginx/heimweg-nominatim.htpasswd
cp /opt/osrm/nginx-nominatim-local.conf /etc/nginx/conf.d/heimweg-nominatim.conf
nginx -t
systemctl reload nginx
```

`htpasswd` fragt das **HTTP-Servicepasswort** ab. Nur beim ersten Anlegen `-c` verwenden; spätere Passwortänderungen mit `htpasswd -B /etc/nginx/heimweg-nominatim.htpasswd heimweg`. Die vorhandene OSRM-Passwortdatei bleibt erhalten.

LXC-Port 4433 in der Proxmox-/Netzwerkfirewall nur für die Quell-IP des äußeren Reverse Proxy freigeben. Port 8081 bleibt auf Loopback; Datenbankport 5432 wird nicht veröffentlicht. nginx gibt nur `GET /search` frei und entfernt die Zugangsdaten vor der Weitergabe an Nominatim. Weitere API-Pfade sind nicht freigegeben.

## 5. Äußeren Reverse Proxy ergänzen

Für die Geocoding-Domain einen öffentlichen HTTPS-VHost mit gültigem Zertifikat anlegen:

| Einstellung | Wert |
| --- | --- |
| Upstream | `https://LXC-IP:4433` |
| TLS-SNI / Prüfhostname | `osrm.internal` |
| Vertrauensanker | bestehende OSRM-CA, nur die öffentliche ca.crt |
| Upstream-Zertifikatprüfung | aktiviert |
| Authorization, URI und Query | unverändert weiterreichen |
| Request-Logging und Cache | deaktiviert |

Für nginx liegt der passende Location-Block in `nginx-nominatim-upstream.conf.example`. Die Beispiel-IP ersetzen und in einen eigenen öffentlichen Geocoding-VHost übernehmen. Der bestehende OSRM-VHost bleibt erhalten. Keine zusätzliche Basic-Auth-Schicht verwenden, die den weitergereichten Authorization-Header ersetzt. Adresssuchanfragen enthalten personenbezogene Daten: keine vollständigen URLs oder Querystrings in Proxy-/APM-Logs schreiben.

Vom äußeren Proxy direkt zum LXC testen (Beispiel-IP ersetzen; CA wie in der OSRM-Anleitung):

```bash
curl --cacert /etc/nginx/trust/osrm-ca.crt \
  --resolve osrm.internal:4433:192.0.2.20 \
  --user heimweg --get 'https://osrm.internal:4433/search' \
  --data-urlencode 'q=Ober-Ramstadt, Deutschland' \
  --data-urlencode 'format=jsonv2'
```

Ohne Zugangsdaten muss `/search` 401 liefern, mit korrekten Zugangsdaten ein JSON-Array. Kein `curl -k` verwenden. Anschließend vom Plesk-Server denselben Suchaufruf über die öffentliche Geocoding-Domain testen.

## 6. Heimweg konfigurieren

In der **.env der Heimweg-App auf Plesk** zum bestehenden OSRM-Block ergänzen:

```dotenv
NOMINATIM_URL=https://geocoding.example.org
NOMINATIM_USERNAME=heimweg
NOMINATIM_PASSWORD="dein-im-lxc-vergebenes-geocoding-servicepasswort"
```

Wenn der äußere Proxy ausdrücklich auf Port 4433 lauscht, beispielsweise `NOMINATIM_URL=https://routing.example.org:4433` verwenden. **Keinen /search-Pfad an die Basis-URL anhängen.** `MAP_PROVIDER=osrm` und `PROVIDER_MODE=self-hosted` bleiben erhalten. Danach die Heimweg-App neu starten und die Adresssuche testen. Die Zugangsdaten bleiben im Backend.

## Betrieb und Sicherung

```bash
cd /opt/osrm
docker compose --env-file nominatim.env -f compose.nominatim.yaml stop
docker compose --env-file nominatim.env -f compose.nominatim.yaml start
```

Das benannte PostgreSQL-Volume bleibt bei Neustarts und Containerersetzung erhalten. **Kein down -v und kein Volume-Pruning verwenden.** Für eine konsistente Dateisicherung zuerst diesen Nominatim-Stack stoppen, das Volume sichern und anschließend wieder starten. Außerdem nominatim.env, Image-Digest, nginx-Konfiguration und Passwortdatei geschützt sichern.

Automatische OSM-Datenupdates sind in dieser Vorlage deaktiviert. Eine Änderung von PBF_URL aktualisiert keine bereits importierte Datenbank. Neue Kartendaten in einem separaten Projekt/Volume importieren und kontrolliert umschalten. Image-/PostgreSQL-Upgrades benötigen ein abgestimmtes Migrations- oder Neuimportverfahren; nicht auf latest wechseln. OSRM und Nominatim haben getrennte Kartenbestände.

Quellen: [Image und Import-/Persistenzparameter](https://github.com/mediagis/nominatim-docker/blob/master/howto.md), [Nominatim](https://nominatim.org/release-docs/5.3/admin/Installation/).

Prüfgrenze: CI prüft Compose-Auflösung und nginx-Konfiguration. Der vollständige Hessen-Import und die reale Verbindung zu deinem LXC/Reverse Proxy müssen beim Deployment geprüft werden.
