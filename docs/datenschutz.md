# Datenverarbeitung und Löschkonzept

Heimweg verarbeitet Namen, Heimfahradressen und Koordinaten von Kindern. Hinzu kommen der Feuerwehrstandort, Fahrzeugdaten, das Administratorkonto und zeitlich begrenzte Sitzungs-/Ratenbegrenzungsdaten. Weitere personenbezogene Pflichtfelder gibt es nicht.

## Schutzmaßnahmen in der Anwendung

- Kindername, Adresse und Koordinaten werden gemeinsam mit AES-256-GCM verschlüsselt. Nonces werden zufällig erzeugt; der Datensatzkontext ist als authentifizierte Zusatzinformation gebunden. Das verhindert auch ein unbemerktes Vertauschen verschlüsselter Kinder-Datensätze.
- Der Feuerwehrstandort ist ebenfalls verschlüsselt. Der Schlüssel liegt in einem Deployment-Secret außerhalb der Datenbank und des Git-Repositorys. Das Kontrollfeld erkennt einen falschen Schlüssel beim Start.
- Passwortspeicherung mit Argon2id. Alle APIs mit personenbezogenen Informationen verlangen eine gültige Sitzung. Unberechtigte Datenzugriffe werden im Backend geprüft, unabhängig vom Frontend.
- HTTPS, sichere Cookies, CSRF-Schutz, Content Security Policy, keine Fremdskripte, keine externen Fonts, keine Tracker und kein Local Storage für Personendaten.
- Anwesenheit und Ergebnisse werden nicht historisiert. Eine neue Browserladung startet mit leerer Anwesenheit. Berechnete Routen und Namen bleiben nur im RAM des Prozesses/Workers und im angemeldeten Browser; Abmelden, Seitenwechsel aus der Anwendung oder Sitzungsablauf entfernt die lokale Darstellung.
- Fehlerlogs enthalten nur technische Statusinformationen. Keine Klartext-Adressen, Passwörter, Cookies oder Provider-Request-URLs werden protokolliert.

## Löschen

Ein Kind kann nach Bestätigung in der Verwaltung gelöscht werden. Der Datensatz wird physisch aus der operativen Tabelle entfernt und steht zukünftigen Berechnungen nicht mehr zur Verfügung. Das Frontend verwirft seine vorhandenen Routen bei einer Stammdatenänderung. Die Serverberechnung prüft den Stammdatenstand vor und nach der Optimierung; zwischenzeitliche Änderungen führen zu einem Fehler statt zu einer stillschweigend veralteten neuen Planung.

Bereits geöffnete andere Browser, angefertigte Ausdrucke oder Screenshots lassen sich nicht zentral zurückrufen. Datenbank-Backups, PostgreSQL-WAL, Storage-Snapshots und externe Anbieter können ältere Daten entsprechend ihrer Aufbewahrung enthalten. Der Betreiber muss deshalb eine passende kurze Backup-/Log-Aufbewahrung festlegen und nach einem Restore zwischenzeitliche Löschungen erneut anwenden. Ein Datenbank-DELETE allein garantiert keine sofortige physische Entfernung aus allen Speicherschichten.

Abgelaufene Sitzungen und Ratenbegrenzungen werden spätestens beim regelmäßigen Bereinigungslauf (zehn Minuten) gelöscht. IP-Adressen werden für die Ratenbegrenzung nur als Hash in der Datenbank abgelegt; ein Hash ist keine zugesicherte Anonymisierung. Das permanente Sperrmerkmal des Benutzerkontos bleibt bis zum manuellen Datenbankeingriff bestehen.

## Verantwortung beim Betreiber

Der Betreiber legt fest, wer das Konto nutzen darf, auf welcher Grundlage die Daten verarbeitet werden und welche Informationen gegenüber Erziehungsberechtigten erforderlich sind. Er dokumentiert Zweck, Zugriffe, Aufbewahrung, Löschprozess, Backupzugriff und den Umgang mit Sicherheitsvorfällen. Dienstleister und eventuelle externe Kartendienste sind hinsichtlich Datenübertragung, Vertragsgrundlage, Speicherort und Protokollierung zu prüfen. Die Anwendung ersetzt diese organisatorische und rechtliche Prüfung nicht.

Geokodierung überträgt eine Adresse, Straßenrouting überträgt die Koordinaten der ausgewählten Orte. Auch ohne Namen können diese Daten Rückschlüsse auf Wohnorte zulassen. Deshalb ist kein externer Anbieter voreingestellt. Eigene Dienste werden explizit konfiguriert; für externe Anbieter ist zusätzlich `ALLOW_EXTERNAL_LOCATION_DATA=true` erforderlich. Die Oberfläche zeigt den externen Betrieb an.

Der Backend-Schutz verhindert keinen Zugriff durch Serveradministratoren, kompromittierte Hosts, gestohlene gültige Sitzungen oder ein entsperrtes Endgerät. Gerätezugang, Betriebssystem- und Containerupdates, ein enger Personenkreis und separat geschützte Schlüssel bleiben erforderlich.
