# Eigener OSRM-LXC mit HTTPS und Passwortschutz

Für **Docker im LXC mit lokalem Zertifikat hinter einem vorhandenen Reverse Proxy** die [eigene Docker-Anleitung](osrm-lxc-docker.md) verwenden. Die folgende Anleitung beschreibt den nativen Betrieb ohne Docker und mit eigenem öffentlichem TLS-Endpunkt.

Die Heimweg-App bleibt auf dem Plesk-Server. Ein separater Linux-LXC übernimmt die Straßenberechnung. nginx im LXC schützt die API mit HTTPS und HTTP Basic Auth. Die Zugangsdaten werden ausschließlich von Node an nginx gesendet, weder im Browser noch in URLs oder App-Logs ausgegeben. OSRM selbst erhält das Passwort nicht und lauscht nur auf `127.0.0.1:5000`.

Die passenden Dateien liegen in `deploy/osrm-lxc/`: ein systemd-Dienst, eine HTTP-Konfiguration ausschließlich für Zertifikate und das geschützte HTTPS-Gateway. Die Dateien sind Vorlagen; Hostname und Zertifikatpfade müssen vor dem Aktivieren angepasst werden.

## 1. LXC vorbereiten

Beispiel: eigener unprivilegierter Ubuntu-24.04-LXC mit systemd, Root-Zugang und ausreichend Speicher für den Kartenausschnitt. Weder Docker noch Plesk sind im Routing-LXC notwendig. Die Erstaufbereitung benötigt erheblich mehr CPU/RAM als die wenigen späteren Heimfahrtanfragen; die passende Dimensionierung hängt vom Ausschnitt ab. Mit einem regional passenden Ausschnitt beginnen und den Aufbereitungslauf beobachten, statt eine feste RAM-Garantie anzunehmen.

Eine Adresse wie `routing.example.org` auf den LXC bzw. einen vorgeschalteten, korrekt weiterleitenden Zugang zeigen lassen. Für das unten beschriebene Zertifikatverfahren müssen Port 80 für ACME und Port 443 erreichbar sein. Die Routing-API ist ausschließlich auf 443 verfügbar. Port 5000 wird nicht veröffentlicht und darf auch nicht durch einen weiteren Proxy am Passwortschutz vorbei freigegeben werden.

Als Root im LXC:

```bash
apt update
apt install -y nginx apache2-utils certbot ca-certificates curl git build-essential \
  pkg-config autoconf automake libtool zip unzip tar python3-venv
useradd --system --home /var/lib/heimweg-osrm --shell /usr/sbin/nologin osrm
install -d -o osrm -g osrm -m 750 /var/lib/heimweg-osrm
install -d -m 755 /var/www/letsencrypt
```

Die Befehle setzen einen frischen dedizierten Container voraus. Bestehende Benutzer/Verzeichnisse prüfen, bevor Schritte wiederholt werden.

## 2. OSRM ohne Docker installieren

Bevorzugt eine vertrauenswürdige, zur Distribution passende OSRM-Installation verwenden. Falls selbst kompiliert wird: Das folgende Beispiel nutzt den beim Erstellen dieser Anleitung geprüften Release **v26.10.0**. Aufbereitungswerkzeuge und laufender Server müssen aus derselben Version stammen. Vor einem späteren Upgrade die Releasehinweise und Buildanforderungen prüfen.

Die Release-Anleitung verlangt einen C++20-Compiler, CMake mindestens 3.29, Ninja und vcpkg. Ubuntu 24.04 liefert gegebenenfalls ein älteres CMake; deshalb wird das Buildwerkzeug in einer eigenen Python-Umgebung installiert:

```bash
python3 -m venv /opt/osrm-build-tools
/opt/osrm-build-tools/bin/pip install 'cmake>=3.29,<4' ninja
export PATH=/opt/osrm-build-tools/bin:$PATH
git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg
/opt/vcpkg/bootstrap-vcpkg.sh
export VCPKG_ROOT=/opt/vcpkg
git clone --branch v26.10.0 --depth 1 https://github.com/Project-OSRM/osrm-backend.git /opt/osrm-src
cd /opt/osrm-src
cmake --preset ci-linux
cmake --build --preset ci-linux --parallel 2
cmake --install build
/usr/local/bin/osrm-routed --version
```

Der erste Build kann lange dauern, da vcpkg Bibliotheken aufbereitet. Die tatsächlich verwendeten Commit-/Paketversionen für spätere Wiederholbarkeit notieren. Die Parallelität an den verfügbaren Speicher anpassen. Diese Anleitung enthält keinen ungeprüft ausgeführten Remote-Installer.

## 3. Straßenkarte aufbereiten

Ein regionaler OpenStreetMap-Ausschnitt reicht, sofern alle möglichen Straßenwege darin enthalten sind. Für Ober-Ramstadt ist beispielsweise ein Hessen-Ausschnitt ein möglicher Ausgangspunkt. Fahrten über die Ausschnittgrenze funktionieren nur mit entsprechend erweitertem Datensatz. OSM-/Datenanbieter-Lizenz und Attribution berücksichtigen.

Beispiel als Root; der Dateiname wird bewusst fest auf `region` vereinheitlicht:

```bash
install -d -o osrm -g osrm -m 750 /var/lib/heimweg-osrm/releases/initial
cd /var/lib/heimweg-osrm/releases/initial
curl --fail --location --output region.osm.pbf \
  https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf
/usr/local/bin/osrm-extract --threads 2 -p /opt/osrm-src/profiles/car.lua region.osm.pbf
/usr/local/bin/osrm-partition --threads 2 region.osrm
/usr/local/bin/osrm-customize --threads 2 region.osrm
chown -R osrm:osrm /var/lib/heimweg-osrm/releases/initial
ln -s /var/lib/heimweg-osrm/releases/initial /var/lib/heimweg-osrm/current
```

`region.osrm` ist der Basispfad einer Sammlung von `.osrm.*`-Dateien, nicht zwingend eine einzelne existierende Datei. Alle erzeugten Dateien zusammen erhalten. Die obigen Aufbereitungsschritte sind notwendig; eine heruntergeladene `.osm.pbf` allein kann der Server nicht bedienen.

## 4. OSRM als internen Dienst starten

Die Datei `deploy/osrm-lxc/heimweg-osrm.service` aus dem Heimweg-Repository nach `/etc/systemd/system/heimweg-osrm.service` kopieren. Danach:

```bash
systemctl daemon-reload
systemctl enable --now heimweg-osrm
systemctl status heimweg-osrm
ss -ltn | grep ':5000'
```

Bei Port 5000 muss **127.0.0.1** stehen. Die Unit begrenzt Tabellen auf 100 Orte und deckt damit die maximal 41 Orte einer Heimweg-Planung ab. Sie setzt MLD und die zum Aufbereitungslauf passenden Dateien voraus. Der Betrieb erfolgt als eigener Systembenutzer. Die Unit vermeidet Mount-Namespace-Härtungsoptionen, die je nach unprivilegiertem LXC-Profil nicht funktionieren.

## 5. HTTPS einrichten

Zunächst `deploy/osrm-lxc/nginx-acme.conf` nach `/etc/nginx/conf.d/heimweg-osrm-acme.conf` kopieren und `routing.example.org` ersetzen. Die Konfiguration gibt auf Port 80 ausschließlich den ACME-Challenge-Pfad frei, keine Routinganfragen.

```bash
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d routing.example.org
```

Falls der LXC nicht öffentlich per HTTP erreichbar sein soll, stattdessen ein passend eingerichtetes DNS-01-Verfahren oder vorhandene gültige Zertifikate verwenden. Die Zertifikatsverwaltung liegt im LXC bzw. am TLS-Gateway und ist unabhängig vom Plesk-Zertifikat der Heimweg-App.

## 6. Passwortschutz aktivieren

Das Servicekonto interaktiv anlegen; das Passwort steht dadurch nicht als Befehlsargument oder im Shellverlauf:

```bash
htpasswd -cB /etc/nginx/heimweg-osrm.htpasswd heimweg
chown root:www-data /etc/nginx/heimweg-osrm.htpasswd
chmod 640 /etc/nginx/heimweg-osrm.htpasswd
```

Ein eigenes zufälliges Passwort verwenden. Für spätere Passwortänderungen `htpasswd -B /etc/nginx/heimweg-osrm.htpasswd heimweg` **ohne `-c`** aufrufen, damit weitere Konten nicht überschrieben werden.

Danach `deploy/osrm-lxc/nginx-routing.conf` nach `/etc/nginx/conf.d/heimweg-osrm-routing.conf` kopieren. Hostname sowie Zertifikatpfade anpassen und prüfen:

```bash
nginx -t
systemctl reload nginx
```

Die Konfiguration schützt `/table/v1/driving/` für Matrizen und `/route/v1/driving/` für Fahrzeugkarten; andere API-Funktionen sind nicht veröffentlicht. nginx entfernt den `Authorization`-Header vor der Weitergabe an OSRM. Accesslogs und Request-Fehlerlogs sind in diesen Serverblöcken deaktiviert, weil Routing-URLs Wohnortkoordinaten enthalten. OSRM läuft mit Fehler- statt Debug-Verbosity; auch vorgelagerte Proxys dürfen keine vollständigen URLs/Headers aufzeichnen.

Optional die vorbereiteten `allow`-/`deny`-Zeilen aktivieren und die tatsächliche ausgehende IP des Plesk-Servers eintragen. Mit `satisfy all` sind dann **Passwort und IP-Freigabe** erforderlich. Alternativ kann dieselbe Einschränkung in der Proxmox-/LXC-Firewall erfolgen. Den Zertifikats-Challengezugang dabei gesondert berücksichtigen.

Für Zertifikatserneuerungen den Certbot-Timer prüfen. Unter `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx` einen ausführbaren Hook mit folgendem Inhalt anlegen:

```sh
#!/bin/sh
nginx -t && systemctl reload nginx
```

Anschließend `certbot renew --dry-run` prüfen. Keine dauerhaft selbstsignierten, ungeprüften Zertifikate oder abgeschaltete TLS-Prüfung in der App verwenden.

## 7. Heimweg in Plesk verbinden

In der privaten `.env` der App:

```dotenv
MAP_PROVIDER=osrm
PROVIDER_MODE=self-hosted
OSRM_URL=https://routing.example.org
OSRM_USERNAME=heimweg
OSRM_PASSWORD="das-im-lxc-vergebene-servicepasswort"

# Alternativ zum Passwort direkt in der .env:
# OSRM_PASSWORD_FILE=/var/www/vhosts/example.org/private/heimweg/osrm_password

# Optional: separates eigenes Geokodierungsangebot, falls vorhanden.
NOMINATIM_URL=
# NOMINATIM_USERNAME=heimweg
# NOMINATIM_PASSWORD_FILE=/private/path/geocoding_password
```

App neu starten. Bei `PROVIDER_MODE=self-hosted` gilt der von dir betriebene LXC als eigener Dienst, auch wenn er über eine Domain angesprochen wird. Eine Freigabe für externe Anbieter ist dafür nicht nötig.

Das Konto aus der nginx-Passwortdatei und das Klartextpasswort in der App müssen zusammenpassen. **Nicht den bcrypt-Hash aus der Passwortdatei als App-Passwort verwenden.** `_PASSWORD_FILE` enthält nur das Servicepasswort, keine `benutzer:hash`-Zeile.

Bei aktivem Passwortschutz lehnt Heimweg eine HTTP-URL, unvollständige Zugangsdaten und Zugangsdaten innerhalb der URL beim Start ab. Das Passwort wird als Basic-Authorization-Header ausschließlich vom Backend gesendet. Weiterleitungen werden nicht verfolgt, damit die Zugangsdaten nicht an einen anderen Host gelangen. Routing- und Geokodierungskonten sind voneinander getrennt. ORS-API-Schlüssel und diese Basic-Auth-Einstellungen sind verschiedene Betriebsmodi.

## 8. Verbindung prüfen

Vom Plesk-Server aus zunächst **ohne** Zugangsdaten eine Table-Anfrage an die HTTPS-Adresse senden. Sie muss `401` zurückgeben. Mit `curl --user heimweg` fragt curl das Passwort interaktiv ab; danach muss die Antwort `code: Ok` und echte `durations`/`distances` enthalten. Beispiel mit synthetischen Testpunkten in der Region, ohne Kinderadressen:

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  'https://routing.example.org/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
curl --fail --show-error --user heimweg \
  'https://routing.example.org/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
```

Falls eine IP-Freigabe eingerichtet wurde, muss eine Anfrage von anderen Adressen scheitern. `http://LXC-IP:5000` darf von außerhalb des Containers nicht erreichbar sein. Anschließend in Heimweg eine kleine Planung testen. Bei falschem Passwort meldet die App einen verweigerten Dienstzugriff; sie gibt keine Zugangsdaten aus und erzeugt keine Ersatzrouten.

OSRM enthält keine Adresssuche. Ohne gesonderten Geocoder werden die Koordinaten bei Kindern und Standort einmalig manuell geprüft/eingetragen. Ein optionaler Nominatim-Endpunkt kann mit eigenen Zugangsdaten separat abgesichert werden; dessen Installation ist nicht Bestandteil dieses Routing-LXC-Beispiels.

## Updates und Wiederherstellung

OSRM-Version, verwendetes Fahrprofil, Kartendatum und Aufbereitungsbefehle dokumentieren. Neue Straßendaten in einem neuen Releaseverzeichnis vollständig aufbereiten, prüfen, Dienst stoppen und den `current`-Symlink kontrolliert umschalten. Erst danach neu starten und erneut testen. Live verwendete `.osrm.*`-Dateien nicht einzeln überschreiben. Bei Problemen auf den bisherigen vollständigen Datensatz und die dazu passende OSRM-Version zurückwechseln.

Passwortdatei und App-Servicepasswort getrennt gesichert aufbewahren. Bei Rotation zuerst die Änderung im Wartungsfenster koordinieren, anschließend nginx und Heimweg prüfen. Der LXC enthält Straßendaten und Servicezugänge, keine dauerhaft gespeicherten Kinderstammdaten.

## Quellen und Prüfgrenzen

- [OSRM v26.10.0](https://github.com/Project-OSRM/osrm-backend/releases/tag/v26.10.0)
- [OSRM Build-Anleitung des Releases](https://github.com/Project-OSRM/osrm-backend/blob/v26.10.0/README.md)
- [OSRM Werkzeuge und Parameter](https://github.com/Project-OSRM/osrm-backend/blob/v26.10.0/docs/tools.md)
- [nginx Basic Authentication](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)

Die App-Authentifizierung, Trennung der Zugangsdaten, HTTPS-Vorgabe und das Ablehnen von Redirects werden automatisiert geprüft. Die Templates wurden für dieses Betriebsmodell erstellt; ein realer Build des Kartenausschnitts, LXC-Start und Zertifikatsbezug müssen auf deinem tatsächlichen Container durchgeführt und abgenommen werden. Es wurden keine Befehle auf deinem Proxmox-/Plesk-System ausgeführt.

Für bestehende Installationen: [zusätzlichen Route-Endpunkt freigeben und Fahrzeugkarten einrichten](route-maps.md).
