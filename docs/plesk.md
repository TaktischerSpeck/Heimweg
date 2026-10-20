# Plesk-Deployment ohne Docker

Heimweg benötigt einen Node.js-Prozess und eine MariaDB- oder PostgreSQL-Datenbank. Ein Hostingtarif, der nur statische Dateien oder PHP unterstützt, reicht für das Backend nicht aus. Unter Plesk Linux übernimmt die Node.js-Erweiterung mit Passenger den App-Prozess. Docker ist dafür nicht erforderlich.

## 1. Voraussetzungen und Verzeichnisse

- Plesk Linux mit den Erweiterungen **Node.js** und **Git**.
- Node.js **24 LTS** für die Domain sowie SSH-/Shellzugang für den Abonnementbenutzer und Deployment-Aktionen.
- Eine HTTPS-Domain, beispielsweise `heimweg.example.org`.
- Eine leere MariaDB-Datenbank, vorzugsweise MariaDB **10.11 oder 11.4**. Die Datenbank darf auch auf einem anderen Server liegen.
- Für die Kartenfunktionen entweder ein OpenRouteService-API-Schlüssel oder eigene OSRM-/Nominatim-Endpunkte.

Aufteilung bei einem bereits vorhandenen Domainordner (alle Domains und Benutzernamen sind Platzhalter):

```text
/var/www/vhosts/example.org/heimweg.example.org/          Anwendung und Git-Deployment
/var/www/vhosts/example.org/heimweg.example.org/public/   Dokumentenstamm der Domain
/var/www/vhosts/example.org/private/heimweg/               Konfiguration und Secrets
```

**Nur `heimweg.example.org/public` darf als Dokumentenstamm erreichbar sein.** Projektwurzel, `.env`, `secrets`, `node_modules`, Migrationen und Backups gehören außerhalb des öffentlich erreichbaren Verzeichnisses. Die Namen der Verzeichnisse sind Beispiele und müssen zu deinem Abonnement passen. Ein bereits vorhandener Domainordner muss nicht nach `heimweg` umbenannt werden.

Im Plesk-Dateimanager ist **Basisverzeichnis** das Abonnementverzeichnis, hier `/var/www/vhosts/example.org/`. Der Ordner `heimweg.example.org` enthält direkt `app.cjs`, `package.json`, `src` und `public`. In **Hosting-Einstellungen** bzw. **Node.js → Dokumentenstamm** wählst du `heimweg.example.org/public`. **Node.js → Anwendungsstamm** bleibt `heimweg.example.org`. Ein Screenshot des Projektordners zeigt allein noch nicht, welcher Dokumentenstamm tatsächlich eingestellt ist.

| Ansicht / Einstellung | Beispiel |
| --- | --- |
| Dateimanager relativ zum Basisverzeichnis | `heimweg.example.org/` |
| Git-Deployment und Node-Anwendungsstamm | `/heimweg.example.org` |
| Öffentlicher Dokumentenstamm | `/heimweg.example.org/public` |
| Private Dateien relativ zum Basisverzeichnis | `private/heimweg/` |

Je nach Plesk-Dialog werden diese Pfade mit oder ohne führenden Slash angezeigt. Entscheidend ist das vom Dialog aufgelöste Verzeichnis; es muss zur obigen absoluten Struktur passen.

## 2. Git-Repository in Plesk einrichten

Unter **Websites & Domains → Git → Repository hinzufügen**:

1. Remote-Repository: `https://github.com/TaktischerSpeck/Heimweg.git`.
2. Bereitstellungsbranch: `main`, sobald der Feature-PR gemergt wurde. Für einen Test kann zunächst der PR-Branch verwendet werden.
3. Deployment-Pfad: der vorhandene Domainordner `heimweg.example.org`, nicht dessen `public`-Unterverzeichnis.
4. Automatische Bereitstellung auswählen.

Damit liegen `package.json` und `app.cjs` direkt im Anwendungsverzeichnis. Ein separates Frontend-Build ist nicht nötig.

## 3. MariaDB lokal oder extern verbinden

Für einen eigenen Kartenserver im LXC statt OpenRouteService siehe [OSRM mit Docker und lokalem TLS](osrm-lxc-docker.md) oder [OSRM ohne Docker](osrm-lxc.md). Die Verbindungsdaten werden wie die Datenbankzugänge in der privaten App-Konfiguration eingetragen.

Unter **Datenbanken → Datenbank hinzufügen** eine Datenbank und einen eigenen Datenbankbenutzer anlegen. Für eine externe Datenbank werden diese beim externen Anbieter angelegt. Der Benutzer benötigt Rechte auf **diese Datenbank**, einschließlich Erstellen/Ändern von Tabellen und Indizes für Migrationen. Globale Verwaltungsrechte sind nicht erforderlich.

Für eine externe MariaDB muss der Datenbankserver Verbindungen von der IP des Plesk-Servers erlauben. Bei einer Datenbank auf demselben Server ist `127.0.0.1` üblich; den tatsächlich in Plesk angezeigten Datenbankhost verwenden. Datenbank- und Benutzernamen einschließlich eines eventuellen Plesk-Präfixes vollständig übernehmen.

## 4. Konfiguration und Secrets

### Einrichtung über die Plesk-Oberfläche

Diese Arbeiten lassen sich ohne `chmod` im Terminal erledigen:

1. Unter **Node.js** zunächst Node 24, den Anwendungsstamm `/heimweg.example.org`, den Dokumentenstamm `/heimweg.example.org/public` und `app.cjs` einstellen. **NPM installieren** ausführen. Die App erst nach vollständiger Konfiguration produktiv starten.
2. Unter **Skript ausführen / Run script** das vorhandene npm-Skript **`secrets`** ausführen. Es erzeugt vier zufällige Dateien im Ordner `secrets` und erhält bereits vorhandene Dateien.
3. Im **Dateimanager → Basisverzeichnis** den Ordner `private` öffnen bzw. erstellen und darin `heimweg` erstellen. Er liegt neben dem Domainordner, niemals in dessen `public`.
4. Die vier Dateien aus `heimweg.example.org/secrets/` markieren und über **Mehr → Verschieben** bzw. das entsprechende Kontextmenü nach `private/heimweg/` verschieben. Bereits vorhandene produktive Schlüssel nicht ersetzen. Verschlüsselungsschlüssel gehören zur bestehenden Datenbank und müssen bei Updates erhalten bleiben.
5. In `private/heimweg/` über **+ → Datei erstellen** die Datei `heimweg.env` anlegen und über das Dateimenü im **Text-/Code-Editor** bearbeiten. Den untenstehenden Konfigurationsblock übernehmen und Platzhalter anpassen.
6. In der Spalte **Berechtigungen** auf den Rechtewert klicken, alternativ im Dateimenü **Berechtigungen ändern** wählen. Die genaue Menübezeichnung hängt von der Plesk-Version ab. Nach folgender Tabelle einstellen; Gruppen- und Andere-Häkchen bei privaten Dateien entfernen.
7. Unter **Node.js → Benutzerdefinierte Umgebungsvariablen** den Namen `HEIMWEG_ENV_FILE` und als Wert den vollständigen Pfad zur privaten `heimweg.env` eintragen. Danach **App neu starten**.

| Objekt | Eigentümer: Lesen / Schreiben / Ausführen | Gruppe | Andere | Ergebnis |
| --- | --- | --- | --- | --- |
| `private/heimweg/` | ja / ja / ja | keine | keine | `700`, `rwx------` |
| `heimweg.env`, Schlüssel und Passwortdateien | ja / ja / nein | keine | keine | `600`, `rw-------` |
| Optionales CA-Zertifikat im privaten Ordner | ja / ja / nein | keine | keine | `600`, `rw-------` |

Bei Verzeichnissen bedeutet **Ausführen**, dass der Benutzer den Ordner betreten kann. Bei der `heimweg.env` und Schlüsseln ist kein Ausführen nötig. Die Dateien müssen dem **Abonnement-Systembenutzer** gehören, unter dem auch Passenger und Git-Deployment laufen. Dann kann derselbe Benutzer sie weiterhin im Dateimanager bearbeiten und die App kann sie lesen. Eine `600`-Datei im Besitz von `root` wäre für die App nicht lesbar; fehlende Eigentümerrechte muss ein Administrator korrigieren.

Die Rechte nicht pauschal rekursiv über das gesamte Abonnement oder die Anwendung setzen. Öffentliche Dateien und von Plesk verwaltete Elternverzeichnisse benötigen andere Zugriffsrechte. Kein `777` vergeben und eine bestehende Plesk-Gruppenzuordnung nicht pauschal ändern.

### Alternative über SSH

Als Abonnementbenutzer im Anwendungsverzeichnis:

```bash
cd /var/www/vhosts/example.org/heimweg.example.org
PATH=/opt/plesk/node/24/bin:$PATH
export PATH
npm ci --omit=dev
node scripts/secrets.js
mkdir -p /var/www/vhosts/example.org/private/heimweg
chmod 700 /var/www/vhosts/example.org/private/heimweg
```

Die vier erzeugten Dateien aus `secrets/` in das private Verzeichnis verschieben; anschließend auf Verzeichnisrechte `700` und Dateirechte `600` achten. Bereits bestehende produktive Schlüssel stets erhalten. Diese Schritte als Abonnementbenutzer ausführen, damit auch der Passenger-Prozess die Dateien lesen kann.

Die Datei `/var/www/vhosts/example.org/private/heimweg/heimweg.env` im Plesk-Dateimanager oder über SSH anlegen:

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

Bei einer rein lokalen DB ohne TLS `DB_SSL=false` setzen. Für eine externe DB TLS mit Zertifikatsprüfung verwenden; nicht die Zertifikatsprüfung abschalten. Die eigene CA kann als Datei angegeben werden. Das Passwort steht in einer gequoteten `.env`-Zeile und wird nicht als Shellbefehl ausgeführt. Die Datei über den Dateimanager auf `600` setzen; per SSH ist `chmod 600` die Alternative.

Alternativ sind die Datenbankvariablen in der `.env` direkt in der Projektwurzel möglich; sie liegt bei korrektem Dokumentenstamm ebenfalls außerhalb des Webroots und wird von Git ignoriert. Eine private Konfigurationsdatei bleibt auch dann erhalten, wenn das Deployment-Verzeichnis später neu angelegt wird.

Soll die App zunächst ohne Kartendienst starten, stattdessen `MAP_PROVIDER=osrm` und `PROVIDER_MODE=disabled` setzen. Die Stammdatenverwaltung funktioniert dann, die Straßenroutenberechnung verlangt später einen konfigurierten Anbieter. Details: [routing.md](routing.md).

### Optionaler zusätzlicher Apache-Schutz mit .htaccess

Für das private Verzeichnis gibt es die Vorlage [private.htaccess](../deploy/plesk/private.htaccess). Sie kann über den Dateimanager nach `private/heimweg/` kopiert und dort **`.htaccess`** genannt werden. Alternativ dort direkt eine Datei mit diesem Namen und folgendem Inhalt erstellen:

```apache
# Deny HTTP access to this private directory when Apache processes the request.
Require all denied
```

Diese Datei ausschließlich im **privaten Secret-Ordner** ablegen. Nicht pauschal im Anwendungsstamm oder in `public` ablegen: Dort würde sie unter Apache auch die eigentliche Anwendung sperren.

Der Schutz greift nur, wenn Apache den Zugriff verarbeitet und die Direktive per `AllowOverride` bzw. `AllowOverrideList` zugelassen ist. **nginx und Node.js werten keine .htaccess aus.** Deshalb bleiben der Dokumentenstamm `public`, ein privater Secret-Ordner außerhalb davon und passende Dateirechte erforderlich. Keine Aliase oder Symlinks aus `public` auf den Secret-Ordner anlegen. Dateirechte steuern den lokalen Dateizugriff; `.htaccess` steuert lediglich HTTP-Zugriffe über Apache und schützt nicht vor Dateiänderungen im Plesk-Dateimanager.

Konfiguration und Secrets außerhalb des Git-Deployments bearbeiten. Änderungen an versionierten Anwendungsdateien im Plesk-Editor werden beim nächsten Deployment überschrieben; solche Änderungen gehören ins Repository.

### Zugriffsschutz nach der Einrichtung prüfen

Im Browser ohne Anmeldung die folgenden Pfade relativ zur App-Domain öffnen: `/.env`, `/heimweg.env`, `/secrets/encryption_key`, `/private/heimweg/heimweg.env`, `/src/config.js` und `/package.json`. Erwartet werden **403 oder 404**, niemals der Dateiinhalt. Keine echten Schlüssel zum Testen nach `public` kopieren. Die Startseite und `/healthz` müssen weiterhin funktionieren. Ist eine private Datei abrufbar, zuerst Dokumentenstamm, Aliase und Proxy-Konfiguration korrigieren.

## 5. Plesk-Node-Einstellungen

Unter **Websites & Domains → Node.js**:

| Einstellung                          | Wert für dieses Beispiel                                                   |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Node.js-Version                      | 24 LTS                                                                     |
| Anwendungsmodus                      | Production                                                                 |
| Anwendungsstamm                      | `/heimweg.example.org`                                                                 |
| Dokumentenstamm                      | `/heimweg.example.org/public`                                                          |
| Anwendungsstartdatei                 | `app.cjs`                                                                  |
| Benutzerdefinierte Umgebungsvariable | `HEIMWEG_ENV_FILE=/var/www/vhosts/example.org/private/heimweg/heimweg.env` |

Node.js aktivieren und die App neu starten. `app.cjs` ist der CommonJS-Startpunkt für Passenger und lädt das ES-Modul-Backend. Die Konfigurationsdatei wird von der App selbst geladen; Passenger muss keine `--env-file`-Startoption unterstützen. Kein zusätzlicher PM2- oder systemd-Prozess darf dieselbe App parallel starten.

Die Startmigrationen laufen automatisch. Die Domain aufrufen und mit dem Inhalt der Datei `setup_token` das einmalige Administratorkonto erstellen. Anschließend Standort, Kinder und Fahrzeuge erfassen oder [CSV-Dateien importieren](csv.md).

## 6. Automatisches Deployment über GitHub-Webhook

In Plesk beim Git-Repository **Repository-Einstellungen → Zusätzliche Deployment-Aktionen aktivieren**. Folgende Aktion eintragen, Pfade entsprechend anpassen:

```sh
cd /var/www/vhosts/example.org/heimweg.example.org && HEIMWEG_ENV_FILE=/var/www/vhosts/example.org/private/heimweg/heimweg.env /bin/sh scripts/deploy-plesk.sh
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
| Deployment im chroot findet Pfad nicht | Plesk-Aktionen laufen im Shellkontext des Abonnements. Sichtbare Pfade verwenden, z. B. `cd heimweg.example.org`; `HEIMWEG_ENV_FILE` für diesen Kontext ebenfalls prüfen |
| Große CSV wird vor der App abgewiesen  | Request-Limit im Proxy mindestens **2 MiB**, CSV selbst höchstens 1 MiB                                                                                      |
| Konto gesperrt                         | Nur dokumentierter Datenbankeingriff, siehe [datenbanken.md](datenbanken.md)                                                                                 |
| ORS-Fehler                             | API-Schlüssel, Anbieterfreigabe, Endpunkt und Kontingent prüfen; keine Routingwerte werden erfunden                                                          |

Die App protokolliert keine Datenbankpasswörter oder Kinderadressen. Bei der Fehlersuche auch im Proxy keine Request-Bodies, Cookies oder vollständigen Provider-URLs protokollieren.

## Quellen zu Plesk und Passenger

- [Plesk: Node.js-Unterstützung](https://docs.plesk.com/en-US/obsidian/customer-guide/nodejs-support.76652/)
- [Plesk: Remote Git und zusätzliche Deployment-Aktionen](https://docs.plesk.com/en-US/obsidian/customer-guide/git-support/using-remote-git-hosting.75848/)
- [Plesk: Git-Deployment-Ablauf](https://docs.plesk.com/en-US/obsidian/administrator-guide/website-management/deploying-website-content-using-git%E2%84%A2.75824/)
- [Passenger: Anwendung über restart.txt neu starten](https://www.phusionpassenger.com/docs/advanced_guides/troubleshooting/standalone/restart_app.html)
- [Plesk: Dateien im Dateimanager bearbeiten](https://docs.plesk.com/en-US/obsidian/customer-guide/websites-and-domains/website-content/uploading-content-with-file-manager.74105/)
- [Apache: Geltungsbereich und Voraussetzungen für .htaccess](https://httpd.apache.org/docs/2.4/howto/htaccess.html)
