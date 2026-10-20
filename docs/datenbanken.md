# PostgreSQL und MariaDB

`DB_ENGINE=postgres` bleibt der Standard. `DB_ENGINE=mariadb` aktiviert den MariaDB-Connector und eigene Migrationen. Unterstützte Zielversionen: PostgreSQL 18 sowie MariaDB 10.11 und 11.4. Der Betrieb kann ohne Container erfolgen; ein externer Datenbankserver wird genauso wie ein lokaler über `.env` konfiguriert.

## Externe MariaDB in der .env

```dotenv
DB_ENGINE=mariadb
DB_HOST=db.example.org
DB_PORT=3306
DB_NAME=heimweg
DB_USER=heimweg
DB_PASSWORD="hier-das-passwort-eintragen"
DB_SSL=true
# Optional, wenn der Server eine private CA verwendet:
# DB_SSL_CA_FILE=/private/path/mariadb-ca.pem
```

Der Datenbankserver muss die Client-IP des App-Servers zulassen und die genannte Datenbank sowie den Benutzer bereits enthalten. Die Anwendung legt Tabellen an, keine Datenbank oder Datenbankbenutzer. Der Benutzer braucht Rechte für CRUD sowie Schemaänderungen innerhalb dieser Datenbank. Nur eigene dedizierte Datenbanken verwenden. Ein normaler Plesk-Datenbankbenutzer benötigt keine globalen Administratorrechte.

`DB_SSL=true` aktiviert TLS mit Zertifikatsprüfung. Ein privates CA-Zertifikat wird über `DB_SSL_CA_FILE` eingelesen. Für eine lokale, entsprechend abgeschottete Verbindung kann `DB_SSL=false` gesetzt werden. Es gibt keinen Schalter, um bei aktiviertem TLS ungültige Zertifikate ungeprüft zu akzeptieren.

Alternativ kann `DB_PASSWORD_FILE=/private/path/db_password` verwendet werden. Auch `ENCRYPTION_KEY`, `SETUP_TOKEN`, `BACKUP_KEY` und `ORS_API_KEY` unterstützen entsprechende `_FILE`-Variablen.

Für PostgreSQL funktionieren dieselben `DB_*`-Variablen mit `DB_ENGINE=postgres` und beispielsweise `DB_PORT=5432`. Die bisherigen `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD[_FILE]` und `PGSSL` werden als Fallback weiter unterstützt, wenn keine passenden `DB_*`-Werte gesetzt sind. MariaDB liest ausschließlich die generischen `DB_*`-Zugangsdaten und übernimmt keine versehentlichen PostgreSQL-Portangaben.

## Migrationen und Transaktionen

PostgreSQL verwendet die vorhandenen SQL-Dateien in `migrations/`, MariaDB die Dateien in `migrations/mariadb/`. Beide führen eine `schema_migrations`-Tabelle. Ein bloßer Wechsel von `DB_ENGINE` konvertiert keine vorhandenen Datenbankdateien.

MariaDB nutzt InnoDB-Transaktionen und eine datensatzgebundene Sperre bei Login, Setup und Import. Das dritte falsche Passwort sperrt das Konto auch unter MariaDB exakt nach drei Fehlversuchen; MySQL/MariaDB werten Update-Zuweisungen teils anders als PostgreSQL aus, was in der Implementierung berücksichtigt ist.

Für Migrationen serialisiert ein datenbankspezifischer `GET_LOCK` die Ausführung. MariaDB-DDL führt implizite Commits aus. Deshalb ist die initiale Migration mit wiederholbaren `IF NOT EXISTS`-Schritten aufgebaut und wird erst nach vollständigem Erfolg als angewendet markiert. Künftige MariaDB-Migrationen müssen ebenfalls nach einem Abbruch sicher fortsetzbar sein.

```bash
node scripts/migrate.js
```

Die Migration läuft außerdem automatisch beim App-Start. `.env` wird aus der Projektwurzel geladen. Mit `HEIMWEG_ENV_FILE=/absoluter/privater/pfad/heimweg.env` kann eine private Datei außerhalb des Deployments verwendet werden.

## Manuelle Entsperrung

Nach Anmeldung an der richtigen Datenbank als Administrator:

```sql
SELECT id, username, failed_attempts, locked FROM users;
START TRANSACTION;
UPDATE users SET locked = false, failed_attempts = 0
WHERE username = 'hier-den-geprueften-benutzernamen-eintragen';
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE username = 'hier-den-geprueften-benutzernamen-eintragen'
);
COMMIT;
```

Gilt für beide Datenbanken. Die IP-Ratenbegrenzung läuft unabhängig davon nach ihrem Zeitfenster aus.

## MariaDB-Backup ohne Docker

Die Feldverschlüsselung ist für beide Engines gleich. Komplette Dumps enthalten zusätzlich Konten und andere Betriebsdaten und werden mit dem gesonderten Backup-Schlüssel verschlüsselt. Das Beispiel setzt eine geschützte MariaDB-Client-Konfiguration unter `/private/path/heimweg-client.cnf` voraus:

```ini
[client]
host=db.example.org
port=3306
user=heimweg
password=hier-das-passwort-eintragen
ssl
ssl-verify-server-cert
# ssl-ca=/private/path/mariadb-ca.pem
```

Datei mit `chmod 600` schützen. Für eine lokale Verbindung ohne TLS die SSL-Einträge entsprechend der lokalen Verbindungskonfiguration entfernen. Die Zugangsdaten werden über diese Datei geladen, nicht in eine öffentliche Prozessargumentliste geschrieben.

Als App-Benutzer in Bash mit `set -euo pipefail` und `umask 077`:

```bash
mariadb-dump --defaults-extra-file=/private/path/heimweg-client.cnf \
  --single-transaction --skip-lock-tables --no-tablespaces heimweg \
  | HEIMWEG_ENV_FILE=/private/path/heimweg.env node scripts/backup.js encrypt \
  > /private/path/heimweg.sql.enc.partial
mv /private/path/heimweg.sql.enc.partial /private/path/heimweg.sql.enc
```

`mv` nur nach erfolgreicher Pipeline ausführen; mit `set -e` wird davor abgebrochen. Der Verschlüsselungshelfer verarbeitet maximal 256 MiB. Für größere Datenbanken ein geprüftes Streaming-Verfahren einsetzen.

Restore zunächst in einer isolierten neuen Datenbank testen. Die App während eines produktiven Restore stoppen und die bestehende Datenbank vorher sichern. Beispiel für eine **leere Testdatenbank** `heimweg_restore`:

```bash
HEIMWEG_ENV_FILE=/private/path/heimweg.env node scripts/backup.js decrypt \
  < /private/path/heimweg.sql.enc \
  | mariadb --defaults-extra-file=/private/path/heimweg-client.cnf heimweg_restore
```

MariaDB-Schema-Statements lassen sich beim SQL-Dump-Restore nicht als Gesamtvorgang atomar zurückrollen. Deshalb zunächst eine leere isolierte Datenbank wiederherstellen und erst nach erfolgreicher Prüfung kontrolliert umschalten. Mit den ursprünglichen Verschlüsselungsschlüsseln Migrationen, Anmeldung, Stammdaten und eine Testplanung prüfen. Alte Sitzungen nach dem Restore löschen. Schlüssel und Backup getrennt sichern. SQL-Dumps verschiedener Engines sind nicht direkt kompatibel; für reine Stammdaten ist der [CSV-Transfer](csv.md) vorgesehen.
