# Umsetzung der User Stories

Die Originalanforderungen liegen unverändert in [anforderungen.md](anforderungen.md). Das fachliche Standardziel „letztes Kind möglichst früh zu Hause“ wurde übernommen. Unterstützt werden PostgreSQL 18 und MariaDB 10.11/11.4. Die Erweiterung ergänzt externe DB-Zugänge, CSV-Transfers, natives Node-/Plesk-Deployment und einen optionalen OpenRouteService-Adapter.

| Story | Umsetzung und Prüfung |
| --- | --- |
| US-01 | Docker Compose, konfigurierbarer PostgreSQL-Zugang, Migration 001, leere Erstinstallation, HTTPS-Origin und Betriebshandbuch |
| US-02 | Einmaliger tokengebundener Setup-Endpunkt mit DB-Sperre, Passwortwiederholung im UI, Argon2id, keine Standardzugangsdaten |
| US-03 | Serverseitige Sessions, Secure/HttpOnly/SameSite, CSRF, 30 Minuten Inaktivität, Abmeldung und generische Loginfehler |
| US-04 | Atomare dauerhafte Sperre nach Fehler 3, Reset bei Erfolg vor Sperre, Sitzungsentzug, persistente IP-Ratenbegrenzung, nur manuelle DB-Entsperrung |
| US-05 | Standortformular, Kandidatenauswahl per Nominatim, bestätigte/korrigierbare Koordinaten, verschlüsselte Persistenz |
| US-06 | Kinder-CRUD, sortierte Liste, Suchfeld in Planung, ID, geprüfte Adresse und Koordinaten, Bestätigung bei Änderung/Löschung |
| US-07 | Fahrzeug-CRUD mit eindeutiger Bezeichnung und ganzzahligen Sitzplätzen, keine Seed-Daten |
| US-08 | Mobile Checkboxen, Live-Zähler, explizite leere Auswahl nach neuer Browserladung |
| US-09 | Fahrzeugaktivierung, 1/2 Betreuer einschließlich Fahrer, sofortige Kinderkapazität, ungenutzte Fahrzeuge möglich |
| US-10 | Frontend- und Backendprüfungen für Auswahl, Adressen, positive Kapazitäten, Fehlplätze und geänderte Stammdaten |
| US-11 | OSRM Straßenmatrix mit Zeit und Distanz, asymmetrische Wege, kein Luftlinien-Fallback, konfigurierbare eigene/externe Dienste |
| US-12 | Exakte Teilmengenoptimierung bis 9 Kinder, deterministische Mehrstartsuche mit lokalen Verbesserungen darüber, heterogene Kapazitäten, Worker-Zeitlimit |
| US-13 | Fahrzeug, Betreuer, Kinder, Reihenfolge, Name, Adresse, Uhrzeit, Dauer, Strecke, ungenutzte Fahrzeuge und Übersicht |
| US-14 | Gültige Varianten nach Anzahl, kapazitätsbedingt unmögliche Varianten, optimierte Referenz, getrennte absolute/prozentuale Ersparnis |
| US-15 | Änderbare Auswahl, Neuberechnung, deutliche Veraltet-Markierung, Stammdatenrevisionen und Abbruch bei konkurrierenden Änderungen |
| US-16 | AES-256-GCM mit gebundenem Datensatzkontext, getrennte Secrets, Backup-Verschlüsselung, Migrations-/Wiederherstellungstests |
| US-17 | Datensparsame Felder, physisches Löschen, keine Routenhistorie, kein Browser-Storage/Tracking, dokumentierte Übertragungen und Betreiberpflichten |
| US-18 | Node 24/PostgreSQL 18, npm-Lockfile, CI, wöchentliches Dependency-Scanning, Container-Scan, Healthchecks, Update/Restore/Rollback-Dokumentation |
| US-19 | Auth-/CSRF-/Sperrtests, verschlüsselte DB-Felder, Restore, Kapazitäten, gerichtete Matrizen, Ersparnis, exakter Solver gegen Brute Force, mobile Browserreise |

## Explizite Grenzen und Betriebsabnahme

- Bis 40 Kinder und 8 verfügbare Fahrzeuge pro Berechnung. Mehr erfordert eine Erweiterung und Lastprüfung.
- Eine feste Suchstrategie macht erfolgreiche Ergebnisse reproduzierbar. Bei Überschreitung des einstellbaren Zeitlimits wird ein Fehler statt einer hardwareabhängigen Teilplanung zurückgegeben; dies nutzt die in US-12 erlaubte Fehleralternative.
- Der Zielvergleich verwendet exakte Sekundenwerte mit technischer Rundungstoleranz, keinen frei einstellbaren Bereich für „praktisch gleich gut“.
- Eigene Routing- und Geokodierungsserver müssen separat bereitgestellt werden. Alternativ kann OpenRouteService nach ausdrücklicher Freigabe direkt aus Node verwendet werden. Sie sind keine automatisch installierten Compose-Dienste.
- Die manuelle Eingabe überprüfter Koordinaten ist eine Alternative zur Geokodierung und verlangt eine ausdrückliche Bestätigung.
- Kein dauerhaftes Planungsarchiv. Vorhandene Browserergebnisse sind Momentaufnahmen; Stammdatenänderungen im selben Browser verwerfen die Darstellung, konkurrierende Änderungen werden bei einer Neuberechnung erkannt.
- Für den Produktivstart sind Domain/TLS, Secrets, eigene Provider, ein realer Routingtest und ein `pg_dump`/`pg_restore`-Test durch den Betreiber erforderlich. Lokale synthetische Tests behaupten keine erfolgreichen Tests gegen noch nicht konfigurierte Dienste.

Die bewusst ausgeschlossenen MVP-Funktionen aus der Vorlage bleiben ausgeschlossen: Live-Tracking, automatischer Routenversand, echte Navigation, Mehrmandantenfähigkeit, komplexe Rollen, vollständige Planungshistorie und unbelegte Verkehrsprognosen.
