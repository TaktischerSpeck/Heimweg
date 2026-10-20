# Plesk-Deployment ohne Docker

Heimweg benötigt einen Node.js-Prozess und eine MariaDB- oder PostgreSQL-Datenbank. Ein Hostingtarif, der nur statische Dateien oder PHP unterstützt, reicht für das Backend nicht aus. Unter Plesk Linux übernimmt die Node.js-Erweiterung mit Passenger den App-Prozess. Docker ist dafür nicht erforderlich.

## 1. Voraussetzungen und Verzeichnisse

- Plesk Linux mit den Erweiterungen **Node.js** und **Git**.
- Node.js **24 LTS** für die Domain sowie SSH-/Shellzugang für den Abonnementbenutzer und Deployment-Aktionen.
- Eine HTTPS-Domain, beispielsweise `heimweg.example.org`.
- Eine leere MariaDB-Datenbank, vorzugsweise MariaDB **10.11 oder 11.4**. Die Datenbank darf auch auf einem anderen Server liegen.
- Für die Kartenfunktionen entweder ein OpenRouteService-API-Schlüssel oder eigene OSRM-/Nominatim-Endpunkte.

Empfohlene Aufteilung innerhalb des Abonnements:

```text
/var/www/vhosts/example.org/heimweg/          Anwendung und Git-Deployment
/var/www/vhosts/example.org/heimweg/public/   Dokumentenstamm der Domain
/var/www/vhosts/example.org/private/heimweg/  Konfiguration und Secrets
```

**Nur `heimweg/public` darf als Dokumentenstamm erreichbar sein.** Projektwurzel, `.env`, `secrets`, `node_modules`, Migrationen und Backups gehören außerhalb des öffentlich erreichbaren Verzeichnisses. Die Namen der Verzeichnisse sind Beispiele und müssen zu deinem Abonnement passen.

## 2. Git-Repository in Plesk einrichten

Unter **Websites & Domains → Git → Repository hinzufügen**:

1. Remote-Repository: `https://github.com/TaktischerSpeck/Heimweg.git`.
2. Bereitstellungsbranch: `main`, sobald der Feature-PR gemergt wurde. Für einen Test kann zunächst der PR-Branch verwendet werden.
3. Deployment-Pfad: das Anwendungsverzeichnis `heimweg`, nicht dessen `public`-Unterverzeichnis.
4. Automatische Bereitstellung auswählen.

Damit liegen `package.json` und `app.cjs` direkt im Anwendungsverzeichnis. Ein separates Frontend-Build ist nicht nötig.

## 3. MariaDB lokal oder extern verbinden

Für einen eigenen Kartenserver im LXC statt OpenRouteService siehe [OSRM-LXC mit HTTPS/Passwort](osrm-lxc.md). Die Verbindungsdaten werden wie die Datenbankzugänge in der privaten App-Konfiguration eingetragen.

Unter **Datenbanken → Datenbank hinzufügen** eine Datenbank und einen eigenen Datenbankbenutzer anlegen. Für eine externe Datenbank werden diese beim externen Anbieter angelegt. Der Benutzer benötigt Rechte auf **diese Datenbank**, einschließlich Erstellen/Ändern von Tabellen und Indizes für Migrationen. Globale Verwaltungsrechte sind nicht erforderlich.

Für eine externe MariaDB muss der Datenbankserver Verbindungen von der IP des Plesk-Servers erlauben. Bei einer Datenbank auf demselben Server ist `127.0.0.1` üblich; den tatsächlich in Plesk angezeigten Datenbankhost verwenden. Datenbank- und Benutzernamen einschließlich eines eventuellen Plesk-Präfixes vollständig übernehmen.

## 4. Konfiguration und Secrets

Als Abonnementbenutzer im Anwendungsverzeichnis:

```bash
cd /var/www/vhosts/example.org/heimweg
PATH=/opt/plesk/node/24/bin:$PATH
export PATH
npm ci --omit=dev
node scripts/secrets.js
mkdir -p /var/www/vhosts/example.org/private/heimweg
chmod 700 /var/www/vhosts/example.org/private/heimweg
```

Die vier erzeugten Dateien aus `secrets/` in das private Verzeichnis verschieben; anschließend auf Verzeichnisrechte `700` und Dateirechte `600` achten. Bereits bestehende produktive Schlüssel stets erhalten. Diese Schritte als Abonnementbenutzer ausführen, damit auch der Passenger-Prozess die Dateien lesen kann.

Die Datei `/var/www/vhosts/example.org/private/heimweg/heimweg.env` anlegen:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://heimweg.example.org
DB_ENGINE=mariadb
DB_HOST=db.example.org
DB_PORT=3306
DB_NAME=pleskprefix_heimweg
DB_USER=pleskprefix_heimweg
DB_PASSWORD="hier-das-datenbankpasswort-eintragen"
DB_SSL=true
# Nur bei einer privaten CA zusätzlich erforderlich:
# DB_SSL_CA_FILE=/var/www/vhosts/example.org/private/heimweg/db-ca.pem

ENCRYPTION_KEY_FILE=/var/www/vhosts/example.org/private/heimweg/encryption_key
SETUP_TOKEN_FILE=/var/www/vhosts/example.org/private/heimweg/setup_token
BACKUP_KEY_FILE=/var/www/vhosts/example.org/private/heimweg/backup_key

# Kartenabfragen direkt aus Node an einen freigegebenen Dienst:
MAP_PROVIDER=ors
PROVIDER_MODE=external
ALLOW_EXTERNAL_LOCATION_DATA=true
ORS_URL=https://api.openrouteservice.org
ORS_API_KEY="hier-den-api-schluessel-eintragen"
```

Bei einer rein lokalen DB ohne TLS `DB_SSL=false` setzen. Für eine externe DB TLS mit Zertifikatsprüfung verwenden; nicht die Zertifikatsprüfung abschalten. Die eigene CA kann als Datei angegeben werden. Das Passwort steht in einer gequoteten `.env`-Zeile und wird nicht als Shellbefehl ausgeführt. Die Datei mit `chmod 600` schützen.

Alternativ sind die Datenbankvariablen in der `.env` direkt in der Projektwurzel möglich; sie liegt bei korrektem Dokumentenstamm ebenfalls außerhalb des Webroots und wird von Git ignoriert. Eine private Konfigurationsdatei bleibt auch dann erhalten, wenn das Deployment-Verzeichnis später neu angelegt wird.

Soll die App zunächst ohne Kartendienst starten, stattdessen `MAP_PROVIDER=osrm` und `PROVIDER_MODE=disabled` setzen. Die Stammdatenverwaltung funktioniert dann, die Straßenroutenberechnung verlangt später einen konfigurierten Anbieter. Details: [routing.md](routing.md).

## 5. Plesk-Node-Einstellungen

Unter **Websites & Domains → Node.js**:

| Einstellung                          | Wert für dieses Beispiel                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Node.js-Version                      | 24 LTS                                                                     |
| Anwendungsmodus                      | Production                                                                 |
| Anwendungsstamm                      | `/heimweg`                                                                 |
| Dokumentenstamm                      | `/heimweg/public`                                                          |
| Anwendungsstartdatei                 | `app.cjs`                                                                  |
| Benutzerdefinierte Umgebungsvariable | `HEIMWEG_ENV_FILE=/var/www/vhosts/example.org/private/heimweg/heimweg.env` |

Node.js aktivieren und die App neu starten. `app.cjs` ist der CommonJS-Startpunkt für Passenger und lädt das ES-Modul-Backend. Die Konfigurationsdatei wird von der App selbst geladen; Passenger muss keine `--env-file`-Startoption unterstützen. Kein zusätzlicher PM2- oder systemd-Prozess darf dieselbe App parallel starten.

Die Startmigrationen laufen automatisch. Die Domain aufrufen und mit dem Inhalt der Datei `setup_token` das einmalige Administratorkonto erstellen. Anschließend Standort, Kinder und Fahrzeuge erfassen oder [CSV-Dateien importieren](csv.md).

## 6. Automatisches Deployment über GitHub-Webhook

In Plesk beim Git-Repository **Repository-Einstellungen → Zusätzliche Deployment-Aktionen aktivieren**. Folgende Aktion eintragen, Pfade entsprechend anpassen:

```sh
cd /var/www/vhosts/example.org/heimweg && HEIMWEG_ENV_FILE=/var/www/vhosts/example.org/private/heimweg/heimweg.env /bin/sh scripts/deploy-plesk.sh
```

Das mitgelieferte Skript:

1. verwendet `/opt/plesk/node/24/bin/node` und das dazugehörige npm,
2. installiert exakt die Laufzeitabhängigkeiten aus dem Lockfile,
3. führt die Migrationen mit derselben privaten Konfiguration aus,
4. erstellt/aktualisiert `tmp/restart.txt`, damit Passenger beim nächsten Request neu startet.

Bei Fehlern wird das Skript abgebrochen und kein erfolgreicher Neustart ausgelöst. Der Deployment-Vorgang ersetzt Dateien im laufenden Verzeichnis; bei größeren Updates ein Wartungsfenster und vorher ein verschlüsseltes Backup einplanen. Für vollständig atomare Releases wäre ein gesondertes Releaseverzeichnis-/Symlink-Verfahren erforderlich.

Danach die **von Plesk angezeigte Webhook-URL** kopieren. In GitHub im Repository unter **Settings → Webhooks → Add webhook**:

- Payload URL: die unveränderte Plesk-Webhook-URL.
- Content type: `application/json`.
- Trigger: **Just the push event**.
- SSL-Verifikation aktiviert lassen; der Plesk-Panelhostname benötigt ein gültiges Zertifikat.

Die Plesk-Webhook-URL enthält eine geheime Kennung und gehört nicht ins Repository. Der Webhook zieht Änderungen und der in Plesk gewählte Branch wird automatisch bereitgestellt. Deshalb nach Möglichkeit einen geschützten `main`-Branch verwenden und CI vor dem Merge verlangen. Der einfache Push-Webhook wartet selbst nicht auf GitHub-Actions-Ergebnisse.

Erster Test: einen freigegebenen Commit auf den konfigurierten Branch bringen und in GitHub die Webhook-Zustellung sowie in Plesk das Deployment-Protokoll kontrollieren. Anschließend `https://heimweg.example.org/healthz`, Anmeldung und eine kleine Testplanung prüfen. Der Webhook wird am Plesk-Panel verarbeitet; die App benötigt keinen eigenen öffentlich aufrufbaren Deployment-Endpunkt.

## Häufige Fehler

| Symptom                                | Prüfung                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 502/503 beim ersten Start              | Node 24 ausgewählt, `npm ci` erfolgreich, Startdatei `app.cjs`, Secret-Dateien für Abonnementbenutzer lesbar?                                                |
| Anmeldung meldet falschen Origin       | `APP_ORIGIN` exakt wie die HTTPS-Browseradresse, ohne abschließenden Slash; anschließend Neustart                                                            |
| MariaDB nicht erreichbar               | `DB_HOST`, Port, vollständige DB-/Benutzernamen, erlaubte Client-IP, Firewall, TLS-CA                                                                        |
| Deployment findet npm nicht            | Node 24 installiert? Falls anderer Pfad: `NODE_BIN=/voller/pfad/node` vor dem Deploy-Skript setzen                                                           |
| Deployment im chroot findet Pfad nicht | Plesk-Aktionen laufen im Shellkontext des Abonnements. Sichtbare Pfade verwenden, z. B. `cd heimweg`; `HEIMWEG_ENV_FILE` für diesen Kontext ebenfalls prüfen |
| Große CSV wird vor der App abgewiesen  | Request-Limit im Proxy mindestens **2 MiB**, CSV selbst höchstens 1 MiB                                                                                      |
| Konto gesperrt                         | Nur dokumentierter Datenbankeingriff, siehe [datenbanken.md](datenbanken.md)                                                                                 |
| ORS-Fehler                             | API-Schlüssel, Anbieterfreigabe, Endpunkt und Kontingent prüfen; keine Routingwerte werden erfunden                                                          |

Die App protokolliert keine Datenbankpasswörter oder Kinderadressen. Bei der Fehlersuche auch im Proxy keine Request-Bodies, Cookies oder vollständigen Provider-URLs protokollieren.

## Quellen zu Plesk und Passenger

- [Plesk: Node.js-Unterstützung](https://docs.plesk.com/en-US/obsidian/customer-guide/nodejs-support.76652/)
- [Plesk: Remote Git und zusätzliche Deployment-Aktionen](https://docs.plesk.com/en-US/obsidian/customer-guide/git-support/using-remote-git-hosting.75848/)
- [Plesk: Git-Deployment-Ablauf](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/deploying-website-content-using-git%E2%84%A2.75824/)
- [Passenger: Anwendung über restart.txt neu starten](https://www.phusionpassenger.com/docs/advanced_guides/troubleshooting/standalone/restart_app.html)
