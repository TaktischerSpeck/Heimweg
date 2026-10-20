# Heimweg

Eine selbst gehostete Webanwendung für die Heimfahrten der Jugendfeuerwehr: Kinder auswählen, verfügbare Fahrzeuge und Betreuer festlegen, Straßenrouten berechnen und Fahrzeugvarianten vergleichen.

## Was enthalten ist

- Einmalige Ersteinrichtung mit geschütztem Setup-Token, Argon2id-Passwörtern, sicheren Sitzungen und dauerhafter Kontosperre nach drei falschen Passwörtern.
- Verwaltung von Feuerwehrstandort, Kindern mit geprüften Adressen und Fahrzeugen mit individuellen Sitzplatzzahlen.
- CSV-Import mit Vorschau und atomarer Übernahme sowie CSV-Export für Kinder/Fahrzeuge.
- Mobile Tagesplanung mit expliziter Anwesenheit, 1 oder 2 Betreuern je Fahrzeug, sofortiger Kapazitätsprüfung und veralteten Ergebnissen nach Änderungen.
- Reale Fahrzeit- und Entfernungsmatrizen über OSRM; Adresssuche über Nominatim oder manuell geprüfte Koordinaten.
- Optimierung für bis zu **40 Kinder und 8 Fahrzeuge**. Jedes Kind wird genau einmal zugeordnet. Verfügbare Fahrzeuge dürfen ungenutzt bleiben.
- Fahrzeugvarianten, optimierte Referenz, getrennte Zeitersparnis für Heimbringzeit und gesamte Fahrzeit, geordnete Stopplisten und Ankunftszeiten.
- Optionale Ausstiegszeit und gesonderte Rückfahrt zur Feuerwehr.
- AES-256-GCM für Namen, Adressen und Koordinaten; keine dauerhafte Routenhistorie, Browser-Telemetrie oder öffentlichen Kartenressourcen.
- PostgreSQL-/MariaDB-Migrationen, native Node-/Plesk-Installation, Docker Compose, Healthcheck, Backup-Werkzeug, automatisierte Backend-/Browserprüfungen und Sicherheitsprüfungen in GitHub Actions.

**Nach der Installation sind keine Kinder und keine Fahrzeuge angelegt.** Die Daten in Tests sind ausschließlich synthetisch und werden vom Produktivserver nicht geladen.

## Installation ohne Docker

- **Plesk mit GitHub-Webhook:** [Schritt-für-Schritt-Anleitung](docs/plesk.md)
- **Normaler Linux-Webserver mit Node/systemd:** [Deployment-Anleitung](docs/node-webserver.md)
- **Externe MariaDB über `.env`:** [Datenbankkonfiguration](docs/datenbanken.md)
- **CSV-Dateien für Kinder und Fahrzeuge:** [Formate, Vorschau und Übernahme](docs/csv.md)

Die App benötigt Node.js 24 LTS. Ein reiner PHP-/Datei-Webspace genügt nicht. Die Node-App kann alle Kartenabfragen an einen konfigurierten Dienst senden; mit OpenRouteService sind keine eigenen Routing-/Geokodierungsserver nötig.

```dotenv
DB_ENGINE=mariadb
DB_HOST=db.example.org
DB_PORT=3306
DB_NAME=heimweg
DB_USER=heimweg
DB_PASSWORD="euer-datenbankpasswort"
DB_SSL=true
MAP_PROVIDER=ors
PROVIDER_MODE=external
ALLOW_EXTERNAL_LOCATION_DATA=true
ORS_API_KEY="euer-api-schluessel"
```

Details zu Secrets, TLS, `.env` und Plesk stehen in den verlinkten Anleitungen. `app.cjs` ist der native Startpunkt; die App lädt die `.env` selbst oder die über `HEIMWEG_ENV_FILE` angegebene private Datei.

## Installation mit Docker Compose

Voraussetzungen: Docker Engine mit Compose v2, eine Domain und ein bestehender Reverse Proxy mit HTTPS. Auf dem Host ist kein Node.js erforderlich.

```bash
git clone https://github.com/TaktischerSpeck/Heimweg.git
cd Heimweg
cp .env.example .env
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/app" -w /app node:24-bookworm-slim node scripts/secrets.js
```

In `.env` mindestens `APP_ORIGIN=https://eure-domain.example` ohne abschließenden Schrägstrich eintragen. Die App setzt HTTPS im Produktivbetrieb voraus. Der Setup-Token sowie Datenbank-, Verschlüsselungs- und Backup-Schlüssel werden zufällig in `secrets/` angelegt; bestehende Dateien überschreibt das Skript nicht.

Der App-Container läuft als UID/GID 1000. Die Secret-Dateien müssen für diese UID lesbar sein, ohne sie für andere Benutzer freizugeben. Bei abweichender Host-UID unter Linux:

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
docker compose up -d --build
docker compose ps
```

Die App ist ausschließlich auf `127.0.0.1:3000` veröffentlicht, PostgreSQL erhält keinen öffentlichen Port. Den HTTPS-Reverse-Proxy auf diesen Port richten; ein Beispiel steht in [deploy/nginx.conf](deploy/nginx.conf). Bei einem Proxy in einem anderen Container muss dieser über ein bewusst eingerichtetes gemeinsames Netzwerk auf die App zugreifen. Die Domain in `APP_ORIGIN` muss exakt der Browseradresse entsprechen.

Danach die Domain aufrufen und mit dem Inhalt von `secrets/setup_token` ein Administratorkonto anlegen. Das Passwort benötigt mindestens 12 Zeichen. Der Token wird nicht in eine URL eingetragen und ist nach erfolgreicher Einrichtung wirkungslos. Anschließend anmelden, Standort erfassen, Kinder und Fahrzeuge anlegen.

**Vor der ersten echten Routenplanung müssen Kartendienste konfiguriert sein.** Ohne Routingdienst werden weder Luftlinienwerte noch Demo-Routen erzeugt.

## Kartendienste

Details und Datenflüsse: [docs/routing.md](docs/routing.md). Als Alternative zu eigenen OSRM-/Nominatim-Diensten unterstützt `MAP_PROVIDER=ors` die gehostete OpenRouteService-API für Matrix und Adresssuche. Der Schlüssel bleibt im Backend; Anbieterlimits und Freigabe müssen passen.

Für selbst betriebene, vom App-Container erreichbare Dienste:

```dotenv
PROVIDER_MODE=self-hosted
OSRM_URL=http://euer-osrm:5000
NOMINATIM_URL=http://euer-nominatim:8080
```

Für ausdrücklich geprüfte externe Anbieter zusätzlich:

```dotenv
PROVIDER_MODE=external
ALLOW_EXTERNAL_LOCATION_DATA=true
OSRM_URL=https://euer-freigegebener-routingdienst.example
NOMINATIM_URL=https://euer-freigegebener-geocoder.example
```

Keine öffentlichen Demo-Endpunkte sind voreingetragen. Im externen Modus weist die Oberfläche auf die Übertragung hin. OSRM muss `table/v1/driving` mit `duration,distance` unterstützen; Nominatim muss die Search-API mit `jsonv2` anbieten. Andere API-Formate benötigen einen Adapter. Die beiden eigenen Dienste sind **nicht im App-Compose enthalten**, da Kartendaten und Ressourcenbedarf vom Einsatzgebiet abhängen. Eine fehlende Adresssuche kann durch manuell geprüfte Koordinaten ersetzt werden; ein fehlender Straßenroutingdienst nicht.

## Konfiguration

| Variable                       | Bedeutung                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `APP_ORIGIN`                   | Exakter öffentlicher HTTPS-Origin für CSRF-Prüfung                           |
| `APP_PORT`                     | Lokaler Host-Port, Standard 3000                                             |
| `PGHOST`, `PGPORT`             | PostgreSQL-Host und Port; Compose-Standard `db:5432`                         |
| `PGDATABASE`, `PGUSER`         | Datenbank und Benutzer                                                       |
| `PGPASSWORD_FILE`              | Datei mit DB-Passwort, im Compose gesetzt                                    |
| `PGSSL=true`                   | TLS mit Zertifikatsprüfung für eine externe Datenbank                        |
| `ENCRYPTION_KEY_FILE`          | Datei mit 32-Byte-Schlüssel, hexkodiert                                      |
| `SETUP_TOKEN_FILE`             | Datei mit einmalig verwendbarem Setup-Token                                  |
| `BACKUP_KEY_FILE`              | Separater Schlüssel für die Verschlüsselung kompletter Backups               |
| `PROVIDER_MODE`                | `disabled`, `self-hosted` oder `external`                                    |
| `OSRM_URL`, `NOMINATIM_URL`    | Basis-URLs der konfigurierten Dienste                                        |
| `ALLOW_EXTERNAL_LOCATION_DATA` | Explizite Freigabe für externen Modus                                        |
| `TRUSTED_PROXY_IP`             | Exakte direkte Proxy-Socket-IP, optional; nur dann wird `X-Real-IP` vertraut |

Die vier Secret-Werte können außerhalb von Compose alternativ direkt über gleichnamige Variablen ohne `_FILE` übergeben werden. Keine Secrets in Git speichern. Bei leerem `TRUSTED_PROXY_IP` gilt die Ratenbegrenzung für die Socket-IP, bei vorgeschaltetem Proxy somit gemeinsam für alle Benutzer. Der Proxy muss `X-Real-IP` selbst überschreiben. PostgreSQL 18 sowie MariaDB 10.11 und 11.4 werden unterstützt. `DB_ENGINE` wählt die Engine; externe Zugangsdaten kommen in `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` und `DB_SSL`. Die bisherigen `PG*`-Werte bleiben PostgreSQL-Fallbacks.

## Entwicklung und Tests

Node.js 24 LTS, npm und PostgreSQL 18 oder MariaDB 10.11/11.4. Paketversionen und transitive Abhängigkeiten sind im Lockfile fixiert.

```bash
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Die lokalen Integrationstests verwenden einen isolierten PostgreSQL-WASM-Kern (PGlite). GitHub Actions führt dieselben Tests zusätzlich gegen PostgreSQL 18 sowie MariaDB 10.11 und 11.4 aus. `TEST_MARIADB_URL` verwendet eine Wegwerf-MariaDB; die Tests löschen dort alle App-Tabellen. Mit `TEST_DATABASE_URL` lässt sich eine lokale Wegwerf-Testdatenbank verwenden: **Die Tests löschen dort das gesamte `public`-Schema. Niemals eine produktive Datenbank angeben.**

Die Browserprüfung startet ausschließlich einen synthetischen Testserver mit deterministischen Providerantworten. Sie testet Einrichtung, Anmeldung, Stammdaten, Kapazitätsprüfung, Routen, veraltete Ergebnisse, mobile Breite, Löschen und Abmelden. Sie ersetzt keinen Abnahmetest mit dem eigenen Straßennetzdienst.

Für lokale Entwicklung eine nicht versionierte `.env` mit `NODE_ENV=development`, `APP_ORIGIN=http://localhost:3000`, Datenbankzugang und gültigen Secrets verwenden; dann `npm run dev`. Nur lokal werden Cookies ohne `Secure` akzeptiert.

## Betrieb und Architektur

- [Installation, Update, verschlüsselte Backups, Restore und Entsperrung](docs/betrieb.md)
- [Routing, Optimierungsziel und Algorithmusgrenzen](docs/routing.md)
- [Datenverarbeitung und Löschkonzept](docs/datenschutz.md)
- [Zuordnung der Umsetzung zu den User Stories](docs/umsetzung.md)
- [Ursprüngliche Projektanforderungen](docs/anforderungen.md)

Das Backend nutzt die Node-HTTP-API und PostgreSQL oder MariaDB. Die direkten Laufzeitabhängigkeiten sind `pg`, `mariadb`, `argon2` und `csv-parse`. Das Frontend benötigt keinen Build-Schritt und keine externen Fonts oder Skripte. Eine berechnete Planung liegt nur im Arbeitsspeicher der Anfrage und im angemeldeten Browser. Ein separater Worker übernimmt die Optimierung; der Webserver bleibt erreichbar.

Der erste MVP enthält keine Live-Karte, Navigations-App-Übergabe, Echtzeit-Verkehrsdaten, Selbstregistrierung, Rollenverwaltung oder dauerhafte Planungshistorie.
