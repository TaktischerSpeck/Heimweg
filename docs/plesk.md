# Plesk-Deployment ohne Docker

Heimweg läuft unter Plesk Linux mit den Erweiterungen **Node.js** und **Git** sowie MariaDB oder PostgreSQL. Diese Anleitung verwendet eine **.env im Anwendungsordner**. Alle Domains und Pfade sind Beispiele.

## 1. Verzeichnisse und Node.js einstellen

Den vorhandenen Projektordner beibehalten:

| Zweck | Beispielpfad |
| --- | --- |
| Anwendung und Git-Deployment | `/var/www/vhosts/example.org/heimweg.example.org/` |
| Öffentlicher Dokumentenstamm | `/var/www/vhosts/example.org/heimweg.example.org/public/` |
| Konfiguration | `/var/www/vhosts/example.org/heimweg.example.org/.env` |
| Schlüssel | `/var/www/vhosts/example.org/heimweg.example.org/secrets/` |

Unter **Websites & Domains → Node.js**:

| Einstellung | Wert |
| --- | --- |
| Node.js-Version | **24 LTS, mindestens 24.15.0**; Node 25 wird nicht unterstützt |
| Package Manager | npm |
| Anwendungsmodus | production |
| Anwendungsstamm | `/heimweg.example.org` |
| Dokumentenstamm | `/heimweg.example.org/public` |
| Anwendungsstartdatei | `app.cjs` |
| Benutzerdefinierte Umgebungsvariablen | Für die Konfiguration über .env nicht erforderlich |

Die Pfade in Plesk beziehen sich auf das Basisverzeichnis des Abonnements. In manchen Dialogen fehlt der führende Slash. `app.cjs`, `package.json` und `public` liegen direkt im Anwendungsstamm. Für den Produktivbetrieb ein gültiges Zertifikat einrichten und HTTPS verwenden; `APP_ORIGIN` muss der tatsächlichen HTTPS-Adresse entsprechen.

**Nur public ist öffentlich.** Die .env und secrets bleiben daneben im Anwendungsordner, niemals in public. Keine Aliase oder Symlinks aus public auf private Dateien anlegen. Eine .htaccess ist bei dieser Aufteilung nicht erforderlich.

## 2. Git und Datenbank vorbereiten

Unter **Git → Repository hinzufügen**:

- Repository: `https://github.com/TaktischerSpeck/Heimweg.git`
- Branch: `main`
- Deployment-Pfad: `heimweg.example.org`, nicht `public`
- Automatische Bereitstellung wählen.

Unter **Datenbanken** eine leere Datenbank und einen eigenen Benutzer anlegen oder eine externe MariaDB verwenden. Unterstützt werden MariaDB 10.11/11.4 und PostgreSQL 18. Der Benutzer benötigt Tabellen-/Index- und Migrationsrechte nur für diese Datenbank. Bei externen Datenbanken die Quell-IP des Plesk-Servers freigeben und TLS mit Zertifikatsprüfung verwenden. Details: [Datenbankkonfiguration](datenbanken.md).

## 3. .env und Schlüssel über die Oberfläche anlegen

1. Unter **Node.js → npm-Installation** die Abhängigkeiten installieren.
2. Über **Skript ausführen** das npm-Skript **`secrets`** starten. Es erzeugt zufällige Schlüssel im Ordner `secrets/` und überschreibt keine vorhandenen Dateien.
3. Im **Dateimanager** den Anwendungsordner öffnen. `.env.example` nach **`.env`** kopieren oder über **+ → Datei erstellen** eine Datei mit diesem Namen anlegen. Im Text-/Code-Editor die folgende Konfiguration eintragen.
4. In der Spalte **Berechtigungen** auf den Rechtewert klicken oder im Dateimenü **Berechtigungen ändern** öffnen. Rechte gemäß Tabelle setzen.
5. Falls bisher `HEIMWEG_ENV_FILE` in Plesk gesetzt war, diese Variable für den Standardweg entfernen. Auch alte benutzerdefinierte Werte für dieselben Konfigurationsvariablen entfernen: bereits gesetzte Prozessvariablen haben Vorrang vor der .env.
6. Nach vollständiger Konfiguration **App neu starten**.

Die Schlüssel bleiben im Anwendungsordner; Verschieben in ein anderes Verzeichnis ist für diesen Standardweg nicht nötig.

### Beispielkonfiguration

Datenbankwerte und **alle absoluten Schlüsselpfade** an das eigene Abonnement anpassen:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://heimweg.example.org

DB_ENGINE=mariadb
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=pleskprefix_heimweg
DB_USER=pleskprefix_heimweg
DB_PASSWORD="hier-das-datenbankpasswort-eintragen"
DB_SSL=false

ENCRYPTION_KEY_FILE=/var/www/vhosts/example.org/heimweg.example.org/secrets/encryption_key
SETUP_TOKEN_FILE=/var/www/vhosts/example.org/heimweg.example.org/secrets/setup_token
BACKUP_KEY_FILE=/var/www/vhosts/example.org/heimweg.example.org/secrets/backup_key

MAP_PROVIDER=osrm
PROVIDER_MODE=disabled
```

`DB_HOST=127.0.0.1` und `DB_SSL=false` sind für eine lokale Datenbank ohne TLS gedacht. Bei externer MariaDB Host und Zugangsdaten ändern und `DB_SSL=true` verwenden; für eine private CA zusätzlich `DB_SSL_CA_FILE` setzen.

Die App lädt die .env neben app.cjs automatisch, auch beim Start über Passenger und beim Deployment-Skript. Es ist keine `HEIMWEG_ENV_FILE`-Variable nötig. Ohne Kartendienst lassen sich Stammdaten verwalten; zur Routenberechnung später den deaktivierten Providerblock ersetzen:

```dotenv
MAP_PROVIDER=osrm
PROVIDER_MODE=self-hosted
OSRM_URL=https://routing.example.org
OSRM_USERNAME=heimweg
OSRM_PASSWORD="hier-das-routing-servicepasswort-eintragen"
```

Installation des eigenen Dienstes: [OSRM in Docker im LXC mit lokalem TLS](osrm-lxc-docker.md). Weitere Anbieter und Adresssuche: [Routing](routing.md).

### Dateirechte im Plesk-Dateimanager

| Objekt | Eigentümer: Lesen / Schreiben / Ausführen | Gruppe | Andere | Rechte |
| --- | --- | --- | --- | --- |
| `.env` und Dateien in `secrets/` | ja / ja / nein | keine | keine | `600`, `rw-------` |
| Ordner `secrets/` | ja / ja / ja | keine | keine | `700`, `rwx------` |

Die Dateien müssen dem **Abonnement-Systembenutzer** gehören, unter dem auch Passenger und Deployment laufen. Dann kann die App sie lesen und du kannst sie im Dateimanager weiter bearbeiten. Bei Verzeichnissen bedeutet Ausführen, dass der Benutzer sie betreten kann. Rechte nicht pauschal rekursiv auf das gesamte Projekt setzen; kein 777 verwenden.

### Bereits vorhandene Konfiguration übernehmen

Wenn eine produktive Konfiguration bisher in einem separaten privaten Ordner liegt, deren Inhalt als .env im Anwendungsstamm übernehmen. **Bestehende Verschlüsselungsschlüssel erhalten.** Die `*_FILE`-Pfade dürfen weiterhin auf die bisherigen Dateien zeigen; Schlüssel müssen nicht verschoben oder neu erzeugt werden. Anschließend `HEIMWEG_ENV_FILE` entfernen und die App neu starten.

## 4. Erster Start

Nach dem Neustart die HTTPS-Domain öffnen und mit dem Inhalt von `secrets/setup_token` das erste Administratorkonto anlegen. Bei übernommenen Schlüsselpfaden den dortigen Setup-Token verwenden. Anschließend Standort, Kinder und Fahrzeuge erfassen oder [CSV importieren](csv.md).

Prüfen:

- `/healthz` und die Startseite funktionieren.
- `/.env`, `/secrets/encryption_key`, `/src/config.js` und `/package.json` liefern **403 oder 404**, niemals Dateiinhalt.
- Anmeldung und nach Einrichtung des Kartendiensts eine kleine Testplanung funktionieren.

## 5. Automatische Updates über Webhook

Beim Plesk-Git-Repository **Zusätzliche Deployment-Aktionen** aktivieren:

```sh
cd /var/www/vhosts/example.org/heimweg.example.org && /bin/sh scripts/deploy-plesk.sh
```

Der Pfad muss zum Shellkontext des Abonnements passen; bei chroot kann stattdessen `cd heimweg.example.org` nötig sein. Das Skript installiert die Laufzeitabhängigkeiten aus dem Lockfile, lädt die .env, führt Migrationen aus und aktualisiert `tmp/restart.txt` für Passenger. Es nutzt standardmäßig `/opt/plesk/node/24/bin/node`; einen abweichenden Installationspfad mit `NODE_BIN` angeben.

Die **von Plesk angezeigte Webhook-URL** in GitHub unter **Settings → Webhooks → Add webhook** eintragen:

| Feld | Wert |
| --- | --- |
| Payload URL | unveränderte Plesk-Webhook-URL |
| Content type | application/json |
| Trigger | Just the push event |
| SSL verification | aktiviert |

Die Webhook-URL enthält eine geheime Kennung und gehört nicht ins Repository. Plesk stellt den dort ausgewählten Branch bereit; der Webhook wartet selbst nicht auf CI. Die eingerichtete PR-Automatik führt vor dem Merge die Prüfungen aus.

**.env und secrets sind in .gitignore ausgeschlossen.** Bei normalen Git-Deployments erhalten lassen; keine Bereinigungsaktionen wie `git clean -fdx` verwenden. Vor Updates Konfiguration, Schlüssel und ein verschlüsseltes Datenbankbackup sichern. Beim Neuaufsetzen oder Ersetzen des ganzen Anwendungsordners müssen .env und secrets wiederhergestellt werden. Änderungen an versionierten Dateien im Plesk-Editor werden beim nächsten Deployment überschrieben.

Nach dem ersten Webhook-Deployment Zustellung in GitHub, Deployment-Protokoll in Plesk sowie Healthcheck und Anmeldung kontrollieren.

## Alternative: separate private Konfiguration

Wer die Konfiguration unabhängig vom Deployment-Verzeichnis halten möchte, kann weiterhin eine Datei außerhalb des Anwendungsordners verwenden und ihren absoluten Pfad unter `HEIMWEG_ENV_FILE` in Plesk setzen. Für die Deployment-Aktion dieselbe Variable vor `/bin/sh scripts/deploy-plesk.sh` setzen. Nicht gleichzeitig eine zweite abweichende .env pflegen.

Die optionale Vorlage [private.htaccess](../deploy/plesk/private.htaccess) kann als .htaccess in einem reinen Secret-Ordner zusätzliche Apache-Zugriffe sperren. **Nicht im Anwendungsstamm oder in public ablegen.** nginx und Node.js beachten keine .htaccess; sie ersetzt weder den korrekten Dokumentenstamm noch Dateirechte.

## Häufige Fehler

| Symptom | Prüfung |
| --- | --- |
| 502/503 oder npm-Engine-Warnung | Node **24.15.0 oder neuer innerhalb von 24.x**, app.cjs, erfolgreiche npm-Installation, Dateieigentümer und Schlüsselpfade |
| Falscher Origin / Anmeldung scheitert | APP_ORIGIN exakt auf die HTTPS-Adresse ohne abschließenden Slash setzen; App neu starten |
| Änderungen an .env wirken nicht | alte Plesk-Umgebungsvariablen bzw. HEIMWEG_ENV_FILE prüfen; App neu starten |
| MariaDB nicht erreichbar | Host, Port, vollständige Datenbank-/Benutzernamen, Client-IP-Freigabe und TLS prüfen |
| Deployment findet npm/Pfade nicht | Node-Installationspfad und chroot-Shellkontext prüfen |
| Große CSV abgewiesen | Proxy-Requestlimit mindestens 2 MiB; CSV selbst höchstens 1 MiB |
| Konto gesperrt | [Dokumentierte Entsperrung](datenbanken.md) |

Quellen: [Plesk Node.js](https://docs.plesk.com/en-US/obsidian/customer-guide/nodejs-support.76652/), [Dateimanager](https://docs.plesk.com/en-US/obsidian/customer-guide/websites-and-domains/website-content/uploading-content-with-file-manager.74105/), [Git-Deployment](https://docs.plesk.com/en-US/obsidian/customer-guide/git-support/using-remote-git-hosting.75848/).
