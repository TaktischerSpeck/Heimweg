# Normaler Linux-Webserver ohne Docker

Benötigt werden Node.js **24 LTS**, MariaDB **10.11/11.4** oder PostgreSQL **18**, ein Reverse Proxy mit HTTPS und ein eigener Systembenutzer. Der Datenbankserver kann lokal oder extern betrieben werden. Das Frontend benötigt keinen Build-Schritt; der Node-Prozess stellt die geschützte API und die App bereit.

## Installation

Node.js 24 über den für deinen Server vorgesehenen Paketweg installieren. Den vollständigen Node-Pfad mit `command -v node` und die Version mit `node --version` prüfen. Für den folgenden systemd-Beispieldienst wird `/usr/bin/node` angenommen; gegebenenfalls anpassen.

Als Administrator einen Benutzer `heimweg` und ein Anwendungsverzeichnis `/opt/heimweg` mit passenden Besitzerrechten anlegen. Als dieser Benutzer:

```bash
git clone https://github.com/TaktischerSpeck/Heimweg.git /opt/heimweg
cd /opt/heimweg
npm ci --omit=dev
node scripts/secrets.js
```

Eine private Konfiguration unter `/etc/heimweg/heimweg.env` anlegen. [Das MariaDB-Beispiel](datenbanken.md) verwenden, dazu:

```dotenv
NODE_ENV=production
APP_ORIGIN=https://heimweg.example.org
HOST=127.0.0.1
PORT=3000
ENCRYPTION_KEY_FILE=/etc/heimweg/encryption_key
SETUP_TOKEN_FILE=/etc/heimweg/setup_token
BACKUP_KEY_FILE=/etc/heimweg/backup_key
MAP_PROVIDER=ors
PROVIDER_MODE=external
ALLOW_EXTERNAL_LOCATION_DATA=true
ORS_API_KEY="provider-api-schluessel"
```

Die erzeugten Secrets nach `/etc/heimweg` verschieben und zusammen mit der Konfiguration ausschließlich dem App-Benutzer zugänglich machen. Die Quelldateien enthalten keine produktiven Secrets. Die Kartendienste können zunächst mit `PROVIDER_MODE=disabled` deaktiviert bleiben.

Migrationen vor dem ersten Start als App-Benutzer ausführen:

```bash
cd /opt/heimweg
HEIMWEG_ENV_FILE=/etc/heimweg/heimweg.env node scripts/migrate.js
```

## Prozess und HTTPS

`deploy/heimweg.service` nach `/etc/systemd/system/heimweg.service` übernehmen und Benutzer, Node-Pfad und Verzeichnisse kontrollieren. Danach als Administrator:

```bash
systemctl daemon-reload
systemctl enable --now heimweg
systemctl status heimweg
```

In einem vorhandenen TLS-Serverblock des nginx-Reverse-Proxys das Beispiel aus `deploy/nginx.conf` einbinden. Es verweist auf `127.0.0.1:3000`, erlaubt 2 MiB Requests und ausreichend Zeit für die Routenberechnung. nginx-Konfiguration prüfen und neu laden. Nur HTTPS öffentlich freigeben, den Node-Port nicht extern veröffentlichen. Bei Apache einen entsprechenden Reverse Proxy mit denselben Header-/Timeout-/Body-Limit-Einstellungen verwenden.

`https://heimweg.example.org/healthz` muss `{"status":"ok"}` liefern. Dann die Domain öffnen, mit dem Setup-Token das Konto anlegen und Stammdaten erfassen. Die Startmigrationen sind wiederholbar; sie laufen auch bei einem normalen App-Start.

## Updates

Vorher ein verschlüsseltes Backup erstellen. Als App-Benutzer `git pull --ff-only`, `npm ci --omit=dev` und `HEIMWEG_ENV_FILE=/etc/heimweg/heimweg.env node scripts/migrate.js` ausführen. Nur nach erfolgreichem Abschluss als Administrator `systemctl restart heimweg`. Danach Healthcheck und Anmeldung prüfen. Ein generischer Webhook, der ohne Authentifizierung Shellbefehle ausführt, wird nicht benötigt; für Plesk ist der [integrierte Git-Webhook](plesk.md) dokumentiert.

Die App funktioniert als laufender Node-Prozess. Ausschließlich HTML-Dateien in einen PHP-Webspace hochzuladen stellt keine Datenbank-, Login- oder Routingfunktionen bereit.
