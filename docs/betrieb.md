# Betrieb von Heimweg

Diese Seite beschreibt überwiegend den ursprünglichen PostgreSQL-/Compose-Betrieb. Für den Betrieb ohne Docker siehe [Plesk](plesk.md) oder [Node-Webserver](node-webserver.md); für MariaDB einschließlich Backup/Restore siehe [Datenbanken](datenbanken.md).

## Erststart und Migrationen

Die Einstellungen werden vor dem Start per Deployment-Umgebung und Secret-Dateien gesetzt. Die App verbindet sich mit der konfigurierten PostgreSQL-Datenbank und führt nummerierte Migrationen aus `migrations/` innerhalb einer Transaktion aus. Eine Tabellensperre schützt Migrationen gegen parallele Ausführung. Für die erste Installation nur eine App-Instanz starten. Eine falsche Verschlüsselungskonfiguration wird anhand eines verschlüsselten Kontrollwerts beim Start erkannt; es werden keine unlesbaren Daten überschrieben.

Der Erststart legt kein Benutzerkonto an. Die tokengebundene Einrichtung erstellt genau ein Administratorkonto. Eine exklusive Datenbanksperre verhindert eine doppelte Ersteinrichtung. Weitere persönliche Konten werden danach von einem Administrator unter **Benutzer** angelegt. Die Rollen **Benutzer** und **Administrator** unterscheiden ausschließlich den Zugriff auf die Kontenverwaltung; beide dürfen planen und Stammdaten pflegen. [Benutzerverwaltung](benutzer.md).

Produktiv unterstützt: PostgreSQL 18 oder MariaDB 10.11/11.4, Node.js 24 LTS, ein App-Prozess. Ein auf mehrere Prozesse verteiltes Optimierungs-Joblimit ist nicht implementiert. Pro Prozess läuft maximal eine Optimierung gleichzeitig. Eine PostgreSQL-Verbindung wird nicht über die gesamte Routenberechnung offen gehalten.

## Anmeldung und Sperre

Passwörter: Argon2id, 64 MiB, drei Durchläufe, Parallelität 1. Sitzungs-IDs enthalten 256 Bit Zufall; nur deren SHA-256-Hash wird in PostgreSQL gespeichert. Cookies verwenden `HttpOnly`, `SameSite=Strict` und produktiv `Secure`. Sitzungen verfallen nach 30 Minuten ohne API-Aktivität. CSRF-Schutz kombiniert exakte Origin-Prüfung mit einem sitzungsgebundenen Token.

Fehlversuche sind atomar durch eine Zeilensperre geschützt. Nach drei falschen Passwörtern wird das Konto dauerhaft gesperrt, Sitzungen werden gelöscht. Eine erfolgreiche Anmeldung vor dem dritten Fehler setzt den Zähler zurück. Bekannte, unbekannte und gesperrte Benutzernamen erhalten dieselbe Fehlermeldung. Die Datenbank begrenzt zusätzlich Loginversuche auf 15 pro 15 Minuten und Socket-/freigegebener Proxy-IP. Das bewusste Sperren eines bekannten Kontos durch Dritte bleibt bei der gewünschten Drei-Versuche-Regel möglich.

Es gibt keinen automatischen Ablauf der Sperre. Ein anderer aktiver Administrator kann unter **Benutzer → Entsperren** das Konto freigeben. Falls kein Administrator mehr anmelden kann, bleibt die gezielte Wiederherstellung durch einen Datenbankadministrator:

```bash
docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Im SQL-Terminal zuerst den Benutzernamen prüfen und anschließend gezielt zurücksetzen:

```sql
SELECT id, username, failed_attempts, locked FROM users;
BEGIN;
UPDATE users SET locked = false, failed_attempts = 0
WHERE username = 'hier-den-geprueften-benutzernamen-eintragen';
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE username = 'hier-den-geprueften-benutzernamen-eintragen'
);
COMMIT;
```

Eine eventuell noch aktive IP-Ratenbegrenzung läuft unabhängig davon nach ihrem Zeitfenster ab.

## Verschlüsselte Backups

Die Anwendung verschlüsselt personenbezogene Felder bereits vor dem Datenbank-Schreibzugriff. Für komplette Backups wird zusätzlich ein **separater** Backup-Schlüssel verwendet. `scripts/secrets.js` erzeugt beide Schlüssel; sie dürfen nicht zusammen mit dem Backup-Archiv abgelegt werden. Beide Schlüssel getrennt und geschützt sichern, beispielsweise in einem Passworttresor mit gesichertem Wiederherstellungszugriff. Ohne den ursprünglichen Datenschlüssel lassen sich die Kinder- und Standortdaten nicht wiederherstellen. Ein neuer zufälliger Schlüssel ist kein Ersatz.

Die folgenden Befehle gelten für eine Bash-Shell unter Linux. `pipefail` verhindert, dass ein fehlgeschlagener Dump als erfolgreiche Sicherung behandelt wird. Backups verlassen die Pipeline ausschließlich verschlüsselt. Das mitgelieferte Werkzeug unterstützt maximal 256 MiB Eingabe, ausreichend für diese reine Stammdatenanwendung; bei größeren Datenbanken ein separat geprüftes Streaming-Backup-Verfahren verwenden.

```bash
set -euo pipefail
umask 077
mkdir -p backups
backup_file="backups/heimweg-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  | docker compose exec -T app node scripts/backup.js encrypt > "$backup_file.partial"
mv "$backup_file.partial" "$backup_file"
```

Nur bei erfolgreicher Pipeline wird `.partial` zum fertigen Backup. Fehlgeschlagene `.partial`-Dateien nach Prüfung löschen. Backups extern verschlüsselt replizieren, Zugriff begrenzen, Aufbewahrungsfrist festlegen und regelmäßig testweise wiederherstellen. Ein Datenbanksnapshot ersetzt die getrennte Schlüsselsicherung nicht.

## Wiederherstellungstest und Restore

Zuerst in einer **isolierten Testumgebung** mit eigener Datenbank, ohne öffentliche Freigabe und mit den ursprünglichen Daten- und Backup-Schlüsseln testen. Die App stoppen, damit keine konkurrierenden Schreibvorgänge auftreten. Der Entschlüsselungsschritt prüft vor Ausgabe des ersten Klartextbytes die vollständige Authentizität des Archivs.

```bash
set -euo pipefail
docker compose stop app
docker compose run --rm -T --no-deps app node scripts/backup.js decrypt < backups/heimweg-DATUM.dump.enc \
  | docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --exit-on-error --single-transaction'
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM sessions; DELETE FROM rate_limits;"'
docker compose up -d app
```

Vor einem Restore der Produktivdatenbank die aktuelle Datenbank separat sichern. Die Befehle ersetzen Tabellen der angegebenen Datenbank und dürfen nicht unbesehen gegen andere Systeme ausgeführt werden.

Nach dem Restore prüfen:

1. Healthcheck ist erfolgreich, App startet ohne Schlüsselfehler.
2. Anmeldung, Standort, Kinderanzahl und Fahrzeuganzahl stimmen.
3. Einen vorher bekannten Datensatz kontrollieren und eine kleine Testplanung berechnen.
4. Es gibt keine Klartext-Adressen in Betriebslogs und keine öffentliche Datenbankfreigabe.

Die automatisierten Tests decken Verschlüsselung, manipulierte Archive, falsche Schlüssel, Migrationen und das Wiedereinlesen wiederhergestellter Datensätze ab. Ein realer `pg_dump`/`pg_restore`-Test gehört zusätzlich zur betrieblichen Abnahme und anschließend in den regelmäßigen Betrieb.

## Update und Rollback

1. Änderungen/Releasehinweise und CI-Ergebnisse prüfen. Vor jedem Update ein verschlüsseltes Backup erstellen und den aktuellen Git-Commit notieren.
2. `git pull --ff-only`, danach `docker compose build --pull app`.
3. App aktualisieren: `docker compose up -d --no-deps app`. Migrationen laufen beim Start. Danach Healthcheck, Anmeldung und eine Testplanung prüfen.
4. PostgreSQL-Minorupdates getrennt planen: Backup, `docker compose pull db`, anschließend kontrollierter Neustart. **Kein automatischer Wechsel der PostgreSQL-Hauptversion** ohne eigenen Datenbank-Upgradeplan.
5. Rollback ohne Schemaänderung: bisherigen geprüften Code-/Image-Stand bereitstellen. Nach inkompatibler Migration zusätzlich das zum alten Stand passende Backup in einer separaten Umgebung wiederherstellen und kontrolliert umschalten. Migrationen werden nicht automatisch rückwärts ausgeführt.

Node- und PostgreSQL-Images sind auf unterstützte Hauptversionen begrenzt; ihre Tags erhalten Sicherheitsupdates. Für unveränderliche Releases nach erfolgreicher CI die konkret getesteten Image-Digests dokumentieren und im eigenen Deployment fixieren. Keine unbeaufsichtigten Produktionsupdates.

GitHub Actions führt Syntaxprüfungen, Tests gegen PostgreSQL und MariaDB, Browserprüfungen, `npm audit` und einen Container-Scan durch. Hohe/kritische bekannte Paketprobleme bzw. behebbare hohe/kritische Containerprobleme blockieren den Job. Dependabot erstellt wöchentlich Updatevorschläge. Neue Advisory-Daten können einen zuvor grünen Build rot werden lassen; Funde vor Freigaben prüfen.

## Logs und Healthcheck

`GET /healthz` prüft die Datenbankverbindung und liefert nur `{"status":"ok"}`. Das Frontend und alle API-Antworten tragen `Cache-Control: no-store`. Die App protokolliert bei internen Fehlern nur Ereignistyp, zufällige Request-ID und Status, niemals Body, Provider-URL, Namen, Adressen, Kennwörter oder Cookies. Providerfehler werden bereinigt weitergegeben. Auch Proxy, Datenbank, Monitoring und Routingdienste müssen entsprechend konfiguriert werden. Keine Request-Body-Aufzeichnung, Session-Replay-Tools oder Debug-Logs mit vollständigen SQL-Parametern aktivieren.
