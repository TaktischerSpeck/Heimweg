# OSRM mit Docker im LXC und lokalem TLS hinter vorhandenem Reverse Proxy

Diese Anleitung installiert **nur den Routingdienst** in einem eigenen LXC. Heimweg bleibt auf Plesk. Im LXC laufen OSRM in Docker und nginx als normaler Linuxdienst. Node.js, MariaDB, Nominatim und ein öffentlicher Zertifikatsbezug werden dort nicht benötigt.

Der Datenweg ist:

1. Heimweg ruft `https://routing.example.org` mit Basic Auth auf.
2. Dein vorhandener Reverse Proxy verwendet dafür sein öffentlich gültiges Zertifikat.
3. Er leitet per HTTPS an die interne LXC-IP weiter und **prüft** dessen lokal ausgestelltes Zertifikat für `osrm.internal`.
4. nginx im LXC prüft Benutzer/Passwort und leitet intern an `127.0.0.1:5000` weiter.

Die Domain `routing.example.org` zeigt auf den vorhandenen Reverse Proxy. `osrm.internal` ist der Zertifikatsname des internen TLS-Endpunkts; bei Verbindung über IP mit explizitem TLS-Namen benötigt er keinen öffentlichen DNS-Eintrag. Im LXC ist kein Let's Encrypt nötig. Auf dem äußeren Proxy weder TLS-Prüfung abschalten noch Basic Auth entfernen. Heimweg vertraut weiterhin dem öffentlichen Zertifikat und braucht die interne CA nicht.

## 1. LXC vorbereiten

Ausgangspunkt: frischer, dedizierter Ubuntu-24.04-LXC, unprivilegiert, mit systemd, fester interner IP und Root-Zugang. Docker in LXC benötigt passende Host-/Kernel-Unterstützung. In Proxmox bei gestopptem Container unter **Optionen → Features** `Nesting` und `keyctl` aktivieren, dann starten. Bestehende Features erhalten. Nicht pauschal auf privilegiert oder AppArmor `unconfined` umstellen, wenn Docker fehlschlägt; zuerst Hostupdates, Containerlogs und Storage-Unterstützung prüfen. Eine VM ist die Alternative, falls die Hostkonfiguration Nested Docker nicht unterstützt.

Für Hessen als Startwert etwa 4 vCPU, 8 GB RAM und 30 GB Disk einplanen; dies ist **keine garantierte Mindestgröße**. Kartenaufbereitung benötigt mehr Speicher als spätere Abfragen. Bei OOM mehr RAM oder einen kleineren Ausschnitt verwenden. Alle tatsächlich gefahrenen Straßen müssen im Ausschnitt liegen, auch Umwege außerhalb der Ortsgrenze.

Alle folgenden Befehle als Root **im LXC**, außer ausdrücklich anders angegeben. Docker nach der [offiziellen Ubuntu-Anleitung](https://docs.docker.com/engine/install/ubuntu/) aus dem Docker-APT-Repository installieren, einschließlich `docker-compose-plugin`. Für einen frischen Ubuntu-LXC:

```bash
apt update
apt install -y ca-certificates curl nginx apache2-utils openssl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
cat > /etc/apt/sources.list.d/docker.sources <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker nginx
docker run --rm hello-world
docker compose version
```

## 2. Dateien ablegen und Image festhalten

Die folgenden Befehle klonen das Repository in ein temporäres Verzeichnis und kopieren nur die Deploymentdateien. Solange diese Dateien noch nicht im Standardbranch veröffentlicht sind, legt der Fallback dieselben Vorlagen direkt an. Die App wird nicht installiert. Der Block läuft in einer eigenen Bash und bricht bei Fehlern ab; vorhandene nginx-Vorlagen im Ziel werden durch die Vorlagen ersetzt.

```bash
bash <<'OSRM_SETUP'
set -euo pipefail
apt update
apt install -y git
install -d -m 755 /opt/osrm/data
osrm_checkout=$(mktemp -d)
trap 'rm -rf "$osrm_checkout"' EXIT
git clone --depth 1 https://github.com/TaktischerSpeck/Heimweg.git "$osrm_checkout/Heimweg"
if [ -d "$osrm_checkout/Heimweg/deploy/osrm-docker" ]; then
  cp "$osrm_checkout/Heimweg/deploy/osrm-docker/"* /opt/osrm/
else
  cat > /opt/osrm/compose.yaml <<'OSRM_TEMPLATE'
services:
  osrm:
    image: ${OSRM_IMAGE:?Set OSRM_IMAGE to the recorded OSRM image digest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:5000:5000"
    volumes:
      - ./data:/data:ro
    command: ["osrm-routed", "--algorithm", "mld", "--max-table-size", "100", "--verbosity", "ERROR", "/data/region.osrm"]
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    logging:
      driver: local
      options:
        max-size: "5m"
        max-file: "2"
OSRM_TEMPLATE
  cat > /opt/osrm/nginx-local.conf <<'OSRM_TEMPLATE'
# Install in the LXC as /etc/nginx/conf.d/osrm-local.conf.
server {
    listen 443 ssl;
    server_name osrm.internal;
    ssl_certificate /etc/nginx/osrm-tls/server.crt;
    ssl_certificate_key /etc/nginx/osrm-tls/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;
    access_log off;
    error_log /dev/null crit;

    auth_basic "Heimweg Routing";
    auth_basic_user_file /etc/nginx/heimweg-osrm.htpasswd;

    # Optional: require the external reverse proxy's actual source IP as well.
    # satisfy all;
    # allow 192.0.2.10;
    # deny all;

    location /table/v1/driving/ {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host localhost;
        proxy_set_header Authorization "";
        proxy_set_header Cookie "";
        proxy_connect_timeout 5s;
        proxy_read_timeout 25s;
        proxy_send_timeout 25s;
        proxy_cache off;
        proxy_buffering off;
    }
    location / { return 404; }
}
OSRM_TEMPLATE
  cat > /opt/osrm/nginx-upstream.conf.example <<'OSRM_TEMPLATE'
# Add this location inside the EXISTING public HTTPS server block.
# Replace the example LXC IP; install only ca.crt on this proxy, never ca.key.
# Disable request logs for the whole routing virtual host, including other layers.
location / {
    access_log off;
    error_log /dev/null crit;
    proxy_pass https://192.0.2.20:443;
    proxy_ssl_server_name on;
    proxy_ssl_name osrm.internal;
    proxy_ssl_trusted_certificate /etc/nginx/trust/osrm-ca.crt;
    proxy_ssl_verify on;
    proxy_ssl_verify_depth 2;
    proxy_ssl_protocols TLSv1.2 TLSv1.3;
    proxy_set_header Host osrm.internal;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Cookie "";
    proxy_connect_timeout 5s;
    proxy_read_timeout 30s;
    proxy_send_timeout 30s;
    proxy_cache off;
    proxy_buffering off;
}
OSRM_TEMPLATE
fi
cd /opt/osrm
osrm_image=ghcr.io/project-osrm/osrm-backend:v26.10.0-debian
docker pull "$osrm_image"
osrm_digest=$(docker image inspect "$osrm_image" --format '{{index .RepoDigests 0}}')
test -n "$osrm_digest"
printf '%s\n' "$osrm_digest" > image-reference.txt
printf 'OSRM_IMAGE=%s\n' "$osrm_digest" > .env
docker compose config --quiet
OSRM_SETUP
```

Der Git-Release heißt `v26.10.0`, der veröffentlichte Container-Tag dagegen **`v26.10.0-debian`**. `no configuration file provided` bedeutet, dass die `compose.yaml` in `/opt/osrm` fehlte; der obige Block legt sie vor dem Compose-Aufruf ab.

Die `.env` enthält damit eine feste Image-Digest-Referenz. **Aufbereitung und laufender Dienst nutzen dasselbe Image.** Nicht ungeprüft `latest` für einen der Schritte verwenden. Der Release v26.10.0 ist der Bezugspunkt dieser Anleitung. Bei anderer Architektur vorher prüfen, ob das Image diese unterstützt.

## 3. Hessen-Karte laden und aufbereiten

```bash
cd /opt/osrm
curl --fail --location --output data/region.osm.pbf \
  https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf
docker compose run --rm --no-deps osrm \
  osrm-routed --version
```

Der reguläre Dienst mountet die Karte schreibgeschützt. Die einmalige Aufbereitung erfolgt deshalb über `docker run` mit schreibbarem Datenverzeichnis:

```bash
cd /opt/osrm
. ./.env
docker run --rm -v /opt/osrm/data:/data "$OSRM_IMAGE" \
  osrm-extract --threads 2 -p /opt/car.lua /data/region.osm.pbf
docker run --rm -v /opt/osrm/data:/data "$OSRM_IMAGE" \
  osrm-partition --threads 2 /data/region.osrm
docker run --rm -v /opt/osrm/data:/data "$OSRM_IMAGE" \
  osrm-customize --threads 2 /data/region.osrm
```

Jeden Schritt nur nach erfolgreichem Abschluss des vorherigen fortsetzen. Bei `Killed`/Exit 137 den RAM-Verbrauch und OOM-Logs prüfen. Alle erzeugten `.osrm.*`-Dateien behalten; `region.osrm` ist deren Basispfad und muss keine einzelne Datei sein.

```bash
docker compose up -d
curl --fail --show-error \
  'http://127.0.0.1:5000/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
```

Erwartet: JSON mit `code: "Ok"`, `durations` und `distances`. Reihenfolge der Koordinaten: **Längengrad,Breitengrad**. Port 5000 ist nur an Loopback gebunden; niemals am äußeren Proxy direkt dorthin weiterleiten. Falls schon ein nativer OSRM-Dienst auf 5000 läuft, diesen vor dem Docker-Start kontrolliert stoppen.

## 4. Lokales Zertifikat mit eigener CA erzeugen

Hier wird eine kleine lokale CA verwendet, die ein Serverzertifikat für `osrm.internal` signiert. Bei vorhandener interner PKI stattdessen dort ein Serverzertifikat mit diesem SAN ausstellen lassen. Keine CA-Schlüssel in Git ablegen.

```bash
install -d -m 700 /root/osrm-ca
install -d -m 700 /etc/nginx/osrm-tls
cd /root/osrm-ca
umask 077
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out ca.key
openssl req -x509 -new -sha256 -days 3650 -key ca.key -out ca.crt \
  -subj '/CN=Heimweg OSRM Local CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
  -out /etc/nginx/osrm-tls/server.key
openssl req -new -key /etc/nginx/osrm-tls/server.key -out server.csr \
  -subj '/CN=osrm.internal'
cat > server.ext <<'EOF_TLS'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:osrm.internal
EOF_TLS
openssl x509 -req -sha256 -days 365 -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -extfile server.ext -out /etc/nginx/osrm-tls/server.crt
openssl verify -CAfile ca.crt -verify_hostname osrm.internal \
  /etc/nginx/osrm-tls/server.crt
```

`ca.crt` ist das öffentliche Vertrauenszertifikat für den äußeren Reverse Proxy. **Nur diese Datei dorthin kopieren**, niemals `ca.key` oder `server.key`. Den CA-Schlüssel anschließend geschützt/offline sichern und nach erfolgreicher Sicherung aus dem laufenden LXC entfernen, sofern er dort nicht für einen definierten Erneuerungsprozess benötigt wird.

Das Serverzertifikat läuft nach 365 Tagen ab. Rechtzeitig mit derselben CA erneuern, prüfen und nginx neu laden; das ist hier kein automatischer ACME-Prozess. Ablauf prüfen:

```bash
openssl x509 -checkend 2592000 -noout -in /etc/nginx/osrm-tls/server.crt
```

Exit 1 bedeutet: innerhalb von 30 Tagen ablaufend oder bereits abgelaufen. Bei CA-Wechsel zuerst den neuen Vertrauensanker am äußeren Proxy hinterlegen.

## 5. nginx im LXC mit Passwortschutz starten

```bash
htpasswd -cB /etc/nginx/heimweg-osrm.htpasswd heimweg
chown root:www-data /etc/nginx/heimweg-osrm.htpasswd
chmod 640 /etc/nginx/heimweg-osrm.htpasswd
cp /opt/osrm/nginx-local.conf /etc/nginx/conf.d/osrm-local.conf
nginx -t
systemctl reload nginx
```

`htpasswd` fragt das Servicepasswort interaktiv ab. Bei weiteren Benutzern oder Passwortänderungen **ohne `-c`** arbeiten. Die Vorlage veröffentlicht nur die von Heimweg benötigte `/table/v1/driving/`-API; andere Pfade liefern 404. nginx entfernt den Authorization-Header vor OSRM.

In der Proxmox-/LXC-Firewall TCP 443 nur für die interne Quell-IP des vorhandenen Reverse Proxy erlauben; administrativen SSH-Zugang separat erhalten. Alternativ die vorbereiteten `allow`/`deny`-Zeilen in `nginx-local.conf` aktivieren. Bei diesen IP-Regeln zählt die tatsächliche Proxy-/NAT-Quell-IP, nicht ein vom Client gelieferter Header. Keine Portweiterleitung von außen zum LXC nötig. HTTP/80 wird für dieses Setup nicht benötigt; einen frischen nginx-Default-VHost bei Bedarf deaktivieren.

## 6. Bestehenden Reverse Proxy verbinden

Im vorhandenen Proxy einen HTTPS-VHost für `routing.example.org` mit dessen öffentlichem Zertifikat verwenden. Upstream:

| Einstellung | Wert |
| --- | --- |
| Upstream-Protokoll | HTTPS |
| Ziel | interne LXC-IP, Port 443 |
| TLS-SNI / Prüfhostname | `osrm.internal` |
| Vertrauensanker | öffentliche Datei `ca.crt` aus Schritt 4 |
| Upstream-Zertifikatprüfung | aktiviert |
| Authorization-Header | unverändert weiterreichen |
| URI und Query | unverändert weiterreichen |
| Cache / Request-Logging | deaktiviert |

Für **nginx als äußeren Reverse Proxy** liegt ein fertiger `location`-Block in `nginx-upstream.conf.example`. Die Beispiel-IP `192.0.2.20` ersetzen. `ca.crt` dort als `/etc/nginx/trust/osrm-ca.crt` ablegen, den Block in den vorhandenen öffentlichen HTTPS-VHost integrieren und `nginx -t` sowie Reload ausführen. Keinen zweiten konkurrierenden `location /`-Block anlegen. Eigene Auth-Regeln dürfen den Basic-Auth-Header für den LXC nicht ersetzen.

Bei HAProxy/Traefik/anderer Software gelten dieselben Werte; die nginx-Datei lässt sich dort nicht direkt importieren. Kann eine Proxy-Oberfläche keine eigene CA oder keinen TLS-Prüfhostname konfigurieren, diese Einstellungen in dessen unterstützter Konfiguration ergänzen oder ein dort vertrauenswürdiges internes Zertifikat verwenden. Nicht mit deaktivierter Prüfung umgehen.

Routing-URLs enthalten Koordinaten. Vollständige URLs, Querystrings und Authorization-Header auch am äußeren Proxy, in WAF, APM und Debuglogs nicht speichern. Der LXC-nginx deaktiviert dafür Access- und Request-Fehlerlogs. OSRM läuft mit Fehler-Verbosity. Der Dienst speichert keine Kinderstammdaten.

## 7. Beide Verbindungen prüfen

**Auf dem äußeren Reverse Proxy**, nachdem `ca.crt` dorthin kopiert wurde (Beispiel-IP ersetzen):

```bash
curl --cacert /etc/nginx/trust/osrm-ca.crt \
  --resolve osrm.internal:443:192.0.2.20 \
  --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  'https://osrm.internal/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
```

Erwartet: **401**, keine Zertifikatswarnung. Mit `--user heimweg` hinzufügen und Passwort interaktiv eingeben: **200** und `code: "Ok"`. Ohne `--cacert` darf ein System ohne diese CA den internen Endpunkt nicht als vertrauenswürdig akzeptieren. Niemals `curl -k` als regulären Test verwenden.

**Auf dem Plesk-Server** über die öffentliche Domain:

```bash
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  'https://routing.example.org/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
curl --fail --show-error --user heimweg \
  'https://routing.example.org/table/v1/driving/8.748,49.83;8.749,49.831?annotations=duration,distance'
```

Erwartet: zuerst **401**, danach mit korrektem Passwort **200** und Matrix. Falsches Passwort muss 401 ergeben. Von einem anderen Host darf `LXC-IP:5000` nicht erreichbar sein. Bei 502 die CA-Datei, SNI `osrm.internal`, Zertifikatsablauf, LXC-Firewall und lokalen OSRM-Status prüfen. Redirects vermeiden: Heimweg verfolgt sie für authentifizierte Provider-Anfragen nicht.

## 8. Heimweg verbinden

In der privaten `.env` der **Heimweg-App auf Plesk**, nicht in der OSRM-Compose-`.env`:

```dotenv
MAP_PROVIDER=osrm
PROVIDER_MODE=self-hosted
OSRM_URL=https://routing.example.org
OSRM_USERNAME=heimweg
OSRM_PASSWORD="dein-im-lxc-vergebenes-servicepasswort"
```

Alternativ `OSRM_PASSWORD_FILE` verwenden, siehe [LXC-Anleitung ohne Docker](osrm-lxc.md). App neu starten. Weder `NODE_TLS_REJECT_UNAUTHORIZED=0` setzen noch das interne Zertifikat in der App konfigurieren: Die App spricht den äußeren Proxy mit öffentlichem Zertifikat an.

OSRM liefert Straßenfahrzeiten, keine Adresssuche und keine Kartenkacheln. Kinder-/Standortkoordinaten manuell prüfen oder einen separaten Geocoder verwenden. Dafür ist kein weiterer Dienst Teil dieser Installation.

## Betrieb, Kartenupdates und Rückkehr zum alten Stand

```bash
cd /opt/osrm
docker compose ps
docker compose logs --tail 50 osrm
systemctl status nginx
docker compose restart osrm
```

Neue Karten in einem **separaten Verzeichnis** mit der festgehaltenen Imageversion vollständig aufbereiten. Laufende `.osrm.*`-Dateien niemals überschreiben. Für den Wechsel Dienst stoppen, bisheriges vollständiges `data`-Verzeichnis aufbewahren, den neuen Datensatz als `data` einsetzen und Dienst starten. Matrix erneut prüfen. Bei Fehlern alten vollständigen Datensatz zurücksetzen. Bei Imageupdates müssen Datensatz und Imageversion gemeinsam aktualisiert bzw. zurückgesetzt werden; auch `.env`/Digest sichern. Kein automatisches Watchtower-Update auf einen inkompatiblen Datenstand.

Compose-Datei, Image-Digest, Kartendatum, Profil, nginx-Konfiguration und Servicezugänge sichern. Private Schlüssel getrennt schützen. OSM-/Geofabrik-Lizenz und Attribution beachten.

## Quellen und Prüfgrenzen

- [Offizielle OSRM-Docker-Anleitung](https://github.com/Project-OSRM/osrm-backend#quick-start)
- [OSRM Release v26.10.0](https://github.com/Project-OSRM/osrm-backend/releases/tag/v26.10.0)
- [Docker unter Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [nginx TLS zum Upstream](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_ssl_verify)
- [Proxmox Container-Konfiguration](https://pve.proxmox.com/pve-docs/pct.conf.5.html)

Die Vorlagen ersetzen keinen realen Installationslauf auf deinem LXC. Kartenaufbereitung, Docker-Nesting, Netzverbindung und das Zusammenspiel mit deinem bestehenden Reverse Proxy müssen dort geprüft werden. Es wurde keine Änderung an deinem Proxmox-, Plesk- oder Proxy-System ausgeführt.
