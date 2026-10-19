# Jugendfeuerwehr – Optimierung der Heimfahrten

## 1. Projektziel

Als Jugendfeuerwehr möchten wir Kinder nach dem Dienst mit einem oder mehreren verfügbaren Fahrzeugen möglichst effizient nach Hause bringen. Die Anwendung soll anhand der anwesenden Kinder, ihrer hinterlegten Adressen, der verfügbaren Fahrzeuge und der Anzahl der Betreuer pro Fahrzeug automatisch geeignete Fahrtrouten ermitteln.

Die Anwendung soll einfach zu bedienen, auf einem eigenen Webserver betreibbar und hinsichtlich personenbezogener Daten von Minderjährigen besonders sorgfältig abgesichert sein.

### Fachliche Grundregeln (für die Implementierung verbindlich)

1. **Startpunkt:** Alle Fahrten beginnen an einer konfigurierbaren Adresse der Feuerwehr.
2. **Fahrzeuge:** Jedes Fahrzeug hat eine eigene Gesamtzahl zugelassener Sitzplätze. Pro Fahrt kann es aktiviert oder deaktiviert werden.
3. **Betreuer:** Für jedes aktivierte Fahrzeug wird ausgewählt, ob **1 oder 2 Betreuer** mitfahren. Einer davon fährt das Fahrzeug. Die Betreuer belegen daher insgesamt 1 beziehungsweise 2 Sitzplätze.
4. **Kinderkapazität:** `verfügbare Kinderplätze = Gesamtsitzplätze – ausgewählte Betreuer`. Beispiel: 9 Sitzplätze und 2 Betreuer ergeben 7 Kinderplätze.
5. **Anwesenheit:** Nur ausdrücklich als anwesend markierte Kinder werden eingeplant.
6. **Fahrzeuganzahl:** Aktivierte Fahrzeuge stehen *zur Verfügung*, müssen aber nicht alle benutzt werden.
7. **Routen:** Jedes anwesende Kind muss genau einer Route zugeordnet und an seiner hinterlegten Adresse abgesetzt werden. Kein Fahrzeug darf überbelegt werden.
8. **Standard-Optimierungsziel:** Minimiere die Zeit bis zur **Ankunft des letzten Kindes zu Hause**. Bei gleichem oder nahezu gleichem Ergebnis bevorzuge geringere **Gesamtfahrzeit** und danach **weniger tatsächlich eingesetzte Fahrzeuge**. Zusätzlich sollen Varianten mit weniger Fahrzeugen vergleichbar sein.
9. **Rückfahrt:** Standardmäßig endet die Berechnung der Kinder-Heimbringzeit mit dem letzten Ausstieg. Eine optionale Rückfahrt der Fahrzeuge zur Feuerwehr wird gesondert berechnet und angezeigt; sie darf nicht stillschweigend in die Heimbringzeit eingerechnet werden.
10. **Zeitangaben:** Alle Fahrzeiten sind Prognosen auf Basis des verwendeten Straßennetz-Routingdienstes. Verkehrslage wird nur einbezogen, wenn der eingesetzte Dienst dies tatsächlich unterstützt.

> **Vor der Implementierung fachlich bestätigen:** Ist das Ziel hauptsächlich, dass alle Kinder möglichst früh zu Hause sind (Standard), oder sollen vorrangig Betreuer-/Fahrzeugstunden minimiert werden? Beides kann zu unterschiedlichen Routenvorschlägen führen. Die Anwendung soll die Kennzahlen getrennt ausweisen.

---

## 2. User Stories

### Epic A – Installation und Zugang

#### US-01 – Anwendung auf eigenem Webserver installieren

**Als** Administrator **möchte ich** die Anwendung mit dokumentierten Schritten auf einem eigenen Webserver installieren, **damit** sie ohne aufwendige manuelle Einrichtung nutzbar ist.

**Akzeptanzkriterien**
- Die Anwendung kann über einen dokumentierten Deployment-Weg, bevorzugt Docker Compose, installiert und aktualisiert werden.
- Anwendung und Datenbank werden getrennt konfiguriert; Passwörter oder Schlüssel stehen nicht im Quellcode.
- Datenbanktyp bzw. unterstützte Datenbankverbindung, Host, Port, Datenbankname und Zugangsdaten lassen sich bei der Erstinstallation konfigurieren. Für das MVP darf **eine klar dokumentierte Datenbank-Engine** unterstützt werden, beispielsweise PostgreSQL.
- Beim ersten Start werden Datenbanktabellen mittels versionierter Migrationen erstellt.
- Die Anwendung ist anschließend über einen Reverse Proxy mit HTTPS erreichbar; HTTPS ist für den produktiven Betrieb erforderlich.
- Nach der Installation sind **keine Kinder und keine Fahrzeuge** voreingetragen.
- Eine verständliche Installations-, Update- und Backup-Anleitung liegt bei.

**Abhängigkeiten:** keine.

#### US-02 – Administratorkonto bei der Erstinstallation erstellen

**Als** Administrator **möchte ich** beim erstmaligen Einrichten Benutzername und Passwort festlegen, **damit** es keine bekannten Standard-Zugangsdaten gibt.

**Akzeptanzkriterien**
- Beim ersten Setup ist noch kein Benutzer vorhanden; das Administratorkonto wird einmalig erstellt.
- Der Setup-Zugriff ist mit einem einmaligen, beim Deployment erzeugten Setup-Token oder einer vergleichbar sicheren lokalen Freigabe geschützt.
- Es gibt **kein** ausgeliefertes Standardpasswort und kein Klartextpasswort in einer lokalen Datei.
- Passwörter werden mit einem geeigneten Passwort-Hash-Verfahren wie **Argon2id** gespeichert, nicht reversibel verschlüsselt.
- Nach erfolgreicher Initialisierung ist die Ersteinrichtung deaktiviert und kann nicht öffentlich erneut aufgerufen werden.

**Abhängigkeiten:** US-01.

#### US-03 – Einfache Anmeldung

**Als** berechtigter Benutzer **möchte ich** mich mit Benutzername und Passwort anmelden und abmelden können, **damit** nur autorisierte Personen die Kinderdaten sehen.

**Akzeptanzkriterien**
- Alle Ansichten und API-Endpunkte mit Kinder-, Fahrzeug- oder Routendaten benötigen eine gültige Anmeldung.
- Sessions verwenden sichere, `HttpOnly`- und `Secure`-Cookies sowie passenden CSRF-Schutz.
- Nach Abmeldung ist die Sitzung ungültig; Sessions laufen bei längerer Inaktivität ab.
- Eine fehlgeschlagene Anmeldung gibt keinen Aufschluss darüber, ob der Benutzername existiert.

**Abhängigkeiten:** US-02.

#### US-04 – Konto nach drei Fehlversuchen dauerhaft sperren

**Als** Administrator **möchte ich**, dass ein Benutzerkonto nach drei aufeinanderfolgenden falschen Passworteingaben gesperrt wird, **damit** weitere Anmeldeversuche mit diesem Konto blockiert werden.

**Akzeptanzkriterien**
- Der Fehlversuchszähler wird **in der Datenbank** geführt und bei jedem falschen Passwort atomar erhöht.
- Nach dem **dritten** aufeinanderfolgenden Fehlversuch wechselt das Konto dauerhaft in den Status `locked`.
- Für ein gesperrtes Konto ist auch mit dem korrekten Passwort keine Anmeldung möglich.
- Ein erfolgreicher Login **vor** der Sperre setzt den Zähler auf null zurück.
- Es gibt **keine** automatische Entsperrung, E-Mail-Entsperrung oder Entsperrfunktion in der Weboberfläche.
- Die Entsperrung kann **nur durch einen dokumentierten, manuellen Datenbankeingriff** eines Administrators erfolgen; dabei werden Sperrstatus und Fehlversuchszähler zurückgesetzt.
- Zusätzlich existiert eine IP-/Request-Ratenbegrenzung, damit die Anwendung nicht beliebig viele Anmeldeversuche akzeptiert. Das Risiko einer absichtlichen Kontosperre durch Dritte ist dokumentiert.

**Abhängigkeiten:** US-03.

### Epic B – Stammdaten

#### US-05 – Feuerwehrstandort verwalten

**Als** Administrator **möchte ich** den Startstandort der Heimfahrten hinterlegen, **damit** alle Routen von der richtigen Adresse aus berechnet werden.

**Akzeptanzkriterien**
- Der Standort kann als Adresse eingetragen und bearbeitet werden.
- Die Adresse wird in überprüfte Koordinaten umgesetzt; bei unklarer Adresse wird eine Korrektur angefordert.
- Der Standort wird dauerhaft gespeichert und als Startpunkt für neue Planungen genutzt.

**Abhängigkeiten:** US-03.

#### US-06 – Kinder und Adressen verwalten

**Als** Betreuer **möchte ich** Kinder mit Namen und Heimfahradresse anlegen, bearbeiten und löschen können, **damit** ich die Daten nur einmal erfassen muss.

**Akzeptanzkriterien**
- Pro Kind werden mindestens Name und Heimfahradresse gespeichert; ein interner Datensatz-Identifier wird automatisch vergeben.
- Beim Speichern wird die Adresse validiert und für Routingzwecke geokodiert; das Ergebnis kann geprüft bzw. korrigiert werden.
- Kinder werden in einer übersichtlichen, nach Namen sortierbaren Liste angezeigt.
- Änderung und Löschung sind nach Bestätigung möglich.
- Gelöschte Kinder werden in zukünftigen Planungen nicht mehr verwendet.
- Kinder werden **erst nach Abschluss der Installation** über die Weboberfläche angelegt; keine Beispieldatensätze enthalten reale personenbezogene Daten.

**Abhängigkeiten:** US-03, US-05, US-16.

#### US-07 – Fahrzeuge und Sitzplatzanzahl verwalten

**Als** Betreuer **möchte ich** Fahrzeuge mit Bezeichnung und Gesamtzahl ihrer Sitzplätze anlegen, bearbeiten und löschen können, **damit** die App die Kapazitäten korrekt berücksichtigt.

**Akzeptanzkriterien**
- Jedes Fahrzeug hat mindestens eine eindeutige Bezeichnung und eine positive ganzzahlige Gesamtanzahl an Sitzplätzen.
- Die Anzahl enthält Fahrer- und Betreuerplätze; die Kinderplätze werden je Planung automatisch abgezogen.
- Fahrzeuge erscheinen nach dem Anlegen in der Auswahl für die Tagesplanung.
- Änderungen an Stammdaten beeinflussen neue Berechnungen, aber verfälschen bereits gespeicherte Planungsergebnisse nicht.
- Fahrzeuge werden erst nach der Installation angelegt.

**Abhängigkeiten:** US-03.

### Epic C – Tagesplanung

#### US-08 – Anwesende Kinder auswählen

**Als** Betreuer **möchte ich** in einer Liste per Checkbox markieren, welche Kinder heute anwesend sind, **damit** ich nicht jedes Mal alle Adressen neu eingeben muss.

**Akzeptanzkriterien**
- Es gibt eine übersichtliche, mobil bedienbare Liste aller hinterlegten Kinder.
- Jedes Kind kann mit einem Klick an- oder abgewählt werden.
- Die Ansicht zeigt jederzeit die Anzahl ausgewählter Kinder.
- Nicht ausgewählte Kinder werden nicht in die Routenplanung aufgenommen.
- Beim Erstellen einer neuen Tagesplanung wird die Anwesenheit bewusst neu festgelegt; alte Anwesenheitsstände werden nicht ungefragt übernommen.

**Abhängigkeiten:** US-06.

#### US-09 – Verfügbare Fahrzeuge und Betreuer auswählen

**Als** Betreuer **möchte ich** Fahrzeuge durch Anklicken aktivieren und für jedes aktivierte Fahrzeug 1 oder 2 Betreuer auswählen, **damit** die verfügbaren Kinderplätze sofort sichtbar sind.

**Akzeptanzkriterien**
- Die Oberfläche zeigt alle hinterlegten Fahrzeuge mit einem gut erkennbaren Aktiv-/Inaktiv-Schalter.
- Neben jedem aktiven Fahrzeug ist eine Auswahl **1 Betreuer / 2 Betreuer** vorhanden.
- Die App zeigt pro Fahrzeug sofort die daraus resultierende Kinderkapazität und die Gesamtkapazität aller aktiven Fahrzeuge.
- Fahrzeuge, deren Sitzplatzzahl nicht für die gewählte Anzahl Betreuer ausreicht, können nicht für eine Berechnung verwendet werden.
- Ein Fahrzeug, das verfügbar markiert ist, muss in der optimierten Lösung **nicht zwingend eingesetzt werden**.

**Abhängigkeiten:** US-07.

#### US-10 – Planung vor der Berechnung prüfen

**Als** Betreuer **möchte ich** vor der Optimierung erkennen, ob die ausgewählten Fahrzeuge ausreichen, **damit** ich ungültige Planungen korrigieren kann.

**Akzeptanzkriterien**
- Ohne ausgewähltes Kind oder ohne aktiviertes Fahrzeug ist die Berechnung deaktiviert und es erscheint eine klare Erklärung.
- Bei zu wenigen Kinderplätzen erscheint eine Meldung mit Anzahl der fehlenden Plätze.
- Ungültige oder noch nicht geokodierte Adressen werden vor der Berechnung angezeigt.
- Es wird keine Route erzeugt, in der Kinder fehlen oder Sitzplatzgrenzen überschritten werden.

**Abhängigkeiten:** US-08, US-09.

### Epic D – Routenoptimierung und Ergebnis

#### US-11 – Reale Fahrzeiten und Entfernungen ermitteln

**Als** Betreuer **möchte ich**, dass die Planung auf Straßenrouten statt Luftlinien basiert, **damit** die angegebenen Zeiten praxisnah sind.

**Akzeptanzkriterien**
- Die Anwendung ermittelt eine Fahrzeit- und Distanzmatrix zwischen Feuerwehrstandort und den Adressen der ausgewählten Kinder.
- Die Matrix stammt von einer konfigurierbaren Routinglösung (z. B. selbst betriebener Routingdienst oder ausdrücklich freigegebener externer Dienst).
- Routen und Teilstrecken werden in korrekter Straßenreihenfolge berechnet, nicht nach Luftlinienentfernung sortiert.
- Nicht erreichbare Adressen und Routingfehler werden erkennbar gemeldet; keine erfundenen Zeiten oder Distanzen.
- Die Datenschutzfolgen eines externen Routing-/Geokodierungsdienstes werden dokumentiert; Adressen Minderjähriger dürfen nicht unbemerkt an Dritte gesendet werden.

**Abhängigkeiten:** US-05, US-06, US-10.

#### US-12 – Beste Fahrzeugkombination und Besuchsreihenfolge berechnen

**Als** Betreuer **möchte ich** eine automatisch optimierte Zuordnung von Kindern zu Fahrzeugen einschließlich Besuchsreihenfolge erhalten, **damit** wir insgesamt schnellstmöglich mit dem Heimbringen fertig sind.

**Akzeptanzkriterien**
- Das System berücksichtigt 1 bis N verfügbare Fahrzeuge mit **unterschiedlichen Kapazitäten** sowie die jeweilige Zahl der Betreuer.
- Es kann ein oder mehrere verfügbare Fahrzeuge **ungenutzt lassen**, wenn die Lösung dadurch nach den festgelegten Zielkriterien besser bzw. praktisch gleich gut wird.
- Jedes ausgewählte Kind wird genau einmal einer Route zugeordnet; alle Kapazitätsgrenzen werden eingehalten.
- Primäres Optimierungsziel ist die früheste Ankunft des **letzten** Kindes; sekundär werden Gesamtfahrzeit und danach die Zahl der eingesetzten Fahrzeuge minimiert.
- Ergebnisse sind reproduzierbar, wenn Stammdaten, Optionen und Fahrzeitmatrix identisch sind.
- Die Anwendung nutzt einen geeigneten Algorithmus für ein **Vehicle Routing Problem mit heterogenen Fahrzeugkapazitäten** (nicht lediglich einen einfachen Nearest-Neighbor-Ansatz). Eine exakte optimale Lösung muss bei großen Instanzen nicht garantiert sein; die Oberfläche spricht dann von der **besten gefundenen Lösung**.
- Bei einer einstellbaren Rechenzeitgrenze wird entweder die beste bis dahin gültige Lösung angezeigt oder ein klarer Fehler, niemals eine unvollständige Zuweisung.

**Abhängigkeiten:** US-11.

#### US-13 – Optimierte Routen verständlich anzeigen

**Als** Betreuer **möchte ich** für jedes tatsächlich eingesetzte Fahrzeug die konkrete Fahrreihenfolge sehen, **damit** wir sofort losfahren können.

**Akzeptanzkriterien**
- Für jede Route erscheinen Fahrzeugbezeichnung, Anzahl der Betreuer, Anzahl der Kinder sowie die geordnete Liste der Haltepunkte mit Namen und Adresse.
- Pro Route werden voraussichtliche Fahrzeit, Strecke und Ankunftszeiten an den Haltepunkten angezeigt.
- Es wird sichtbar, welche aktivierten Fahrzeuge nicht benötigt werden.
- Zusätzlich gibt es eine kompakte Gesamtübersicht: Anzahl eingesetzter Fahrzeuge, Kinder, Gesamtfahrzeit und späteste Kinderankunft.
- Die Anzeige ist für Smartphones geeignet.
- Optional für eine spätere Ausbaustufe: Kartenansicht bzw. Übergabe der Stoppreihenfolge an eine Navigations-App. Keine Navigation wird behauptet, solange sie nicht implementiert ist.

**Abhängigkeiten:** US-12.

#### US-14 – Fahrzeugvarianten und Zeitersparnis vergleichen

**Als** Betreuer **möchte ich** nachvollziehen können, wie viel Zeit die vorgeschlagene Planung spart, **damit** ich entscheiden kann, ob der Einsatz weiterer Fahrzeuge sinnvoll ist.

**Akzeptanzkriterien**
- Das System erstellt für die verfügbare Fahrzeugmenge nach Möglichkeit **gültige Varianten** mit unterschiedlicher Zahl tatsächlich eingesetzter Fahrzeuge (z. B. 1, 2 oder 3).
- Varianten mit zu geringer Sitzplatzkapazität werden als **nicht möglich** gekennzeichnet.
- Für jede gültige Variante werden ausgewiesen: eingesetzte Fahrzeuge, späteste Ankunft eines Kindes, Summe der Fahrzeug-Fahrzeiten sowie gesamte Fahrstrecke.
- Eine klar benannte **Referenzvariante** dient für die Ersparnisberechnung, beispielsweise die gültige Planung mit der kleinsten Fahrzeuganzahl. Die Referenz wird ebenfalls optimiert, damit kein künstlich schlechter Vergleich entsteht.
- Ersparnis wird getrennt angezeigt für **Zeit bis zum letzten Kind** und **Summe aller Fahrzeiten**; zusätzlich werden absolute Minuten und, soweit sinnvoll, Prozentwerte gezeigt.
- Es wird klar darauf hingewiesen, dass mehr Fahrzeuge die letzte Ankunft beschleunigen können, zugleich aber mehr Gesamtfahrzeit verursachen können.
- Sind keine weiteren gültigen Varianten vorhanden, wird **keine unbelegte Zeitersparnis** behauptet.

**Abhängigkeiten:** US-12, US-13.

#### US-15 – Tagesplanung ohne Datenverlust neu berechnen

**Als** Betreuer **möchte ich** Anwesenheit, Fahrzeugauswahl und Betreuerzahl ändern und erneut berechnen können, **damit** ich kurzfristig auf Änderungen reagiere.

**Akzeptanzkriterien**
- Änderungen an der Auswahl sind direkt möglich.
- Durch erneutes Klicken auf „Route berechnen“ werden alle betroffenen Zuordnungen und Ergebnisse aktualisiert.
- Alte Ergebnisse werden als veraltet markiert, sobald Eingaben geändert wurden.
- Kinder- und Fahrzeugstammdaten bleiben bei der Neuberechnung erhalten.

**Abhängigkeiten:** US-08 bis US-14.

### Epic E – Sicherheit, Datenschutz und Wartung

#### US-16 – Personenbezogene Daten verschlüsselt speichern

**Als** Verantwortlicher **möchte ich**, dass Kinder- und Adressdaten geschützt in der Datenbank liegen, **damit** ein Datenbankabzug nicht unmittelbar lesbare personenbezogene Daten enthält.

**Akzeptanzkriterien**
- Namen, Straßenadressen und zugehörige Koordinaten werden **anwendungsseitig mit authentifizierter Verschlüsselung** gespeichert, beispielsweise AES-256-GCM. Alternativ ist eine nachweisbar gleichwertige Lösung zulässig.
- Der Verschlüsselungsschlüssel liegt **getrennt von der Datenbank**, z. B. als geschütztes Deployment-Secret; er wird nicht in der Datenbank oder im Git-Repository gespeichert.
- Daten werden nur nach erfolgreicher Anmeldung für autorisierte Funktionen entschlüsselt.
- Auch Backups werden verschlüsselt abgelegt; der Schlüssel und ein dokumentierter Wiederherstellungsprozess werden separat gesichert.
- Technische Betriebslogs enthalten keine Klartext-Kinderadressen, keinen vollständigen Namen-Adressen-Datensatz, keine Passwörter und keine Session-Tokens.
- Migrationen und ein Wiederherstellungstest stellen sicher, dass Datensätze nach Updates oder Restore wieder korrekt gelesen werden können.

**Abhängigkeiten:** US-01; vor US-06 implementieren.

#### US-17 – Daten sparsam und datenschutzgerecht behandeln

**Als** Verantwortlicher **möchte ich** nur notwendige Daten verarbeiten und sie bei Bedarf löschen können, **damit** das System datensparsam betrieben werden kann.

**Akzeptanzkriterien**
- Pflichtdaten werden auf Name und Heimfahradresse beschränkt; weitere Informationen werden nur ergänzt, wenn fachlich notwendig.
- Es gibt eine Funktion zur Löschung eines Kindes einschließlich der zugehörigen nicht mehr benötigten personenbezogenen Daten.
- Temporäre Berechnungsergebnisse werden standardmäßig nicht dauerhaft mit Klarnamen und Adressen historisiert.
- Browser-Caches, Fehlerberichte und Telemetrie geben keine Kinderdaten preis; APIs liefern nur für die jeweilige Funktion notwendige Felder.
- Für externe Routing-/Geokodierungsanbieter sind Auswahl, Datenübertragung und Datenschutzinformationen dokumentiert. Ein lokaler Betrieb der Dienste soll möglich sein, wenn vollständige Kontrolle über die Adressdaten erforderlich ist.
- Eine kurze Betreiber-Dokumentation benennt Verantwortlichkeiten, Löschkonzept und die zu prüfenden Datenschutzpflichten; die Anwendung allein ersetzt keine rechtliche Prüfung.

**Abhängigkeiten:** US-06, US-11, US-16.

#### US-18 – Sicherheitsupdates und einfache Wartung ermöglichen

**Als** Administrator **möchte ich** die Anwendung mit wenig Aufwand aktuell halten, **damit** Sicherheitslücken in Abhängigkeiten schnell behoben werden können.

**Akzeptanzkriterien**
- Verwendete Laufzeit- und Paketversionen sind definiert und über Lockfiles reproduzierbar installierbar.
- Ein dokumentierter Update-Prozess für Anwendung, Container und Datenbankmigrationen ist vorhanden.
- Eine automatisierte Prüfung auf bekannte Schwachstellen in direkten und transitiven Abhängigkeiten ist eingerichtet; kritische Funde werden vor Releases bewertet.
- Für produktiven Betrieb werden gepflegte, unterstützte Laufzeitversionen verwendet; möglichst wenige zusätzliche Pakete.
- Das System bietet Healthchecks sowie aussagekräftige, datensparsame Fehlerlogs.
- Vor Upgrades ist ein Backup möglich; Restore und Rollback sind dokumentiert.

**Abhängigkeiten:** US-01, US-16.

#### US-19 – Kernlogik und Sicherheitsregeln automatisiert testen

**Als** Betreiber **möchte ich** automatisierte Tests für die kritischen Abläufe, **damit** Updates keine fehlerhafte Kinderverteilung oder Sicherheitsprobleme verursachen.

**Akzeptanzkriterien**
- Tests überprüfen Kapazitäten mit 1 und 2 Betreuern sowie Fahrzeugen mit unterschiedlichen Sitzplatzzahlen.
- Tests überprüfen 0, 1, 2 und mehrere Fahrzeuge, nicht ausreichende Kapazitäten und nicht erreichbare Ziele.
- Tests prüfen, dass jedes anwesende Kind genau einmal zugeordnet wird und abwesende Kinder nie erscheinen.
- Tests prüfen, dass die Optimierung verfügbare Fahrzeuge ungenutzt lassen kann.
- Tests prüfen die Referenz- und Ersparnisberechnung anhand fest definierter Fahrzeitmatrizen.
- Authentifizierungstests prüfen Fehlversuche 1, 2 und 3, Sperre nach dem dritten Versuch, erfolgreiche Anmeldung vor der Sperre und die dauerhafte Sperre trotz korrektem Passwort.
- Tests stellen sicher, dass sensible Felder nicht im Klartext in DB und Logs auftauchen.

**Abhängigkeiten:** jeweilige Fachstorys.

---

## 3. Umsetzungsreihenfolge für eine Coding-KI

Implementiere **eine User Story nach der anderen**. Jede Story soll eine kleine, überprüfbare Änderung mit passenden Tests liefern. Nicht mehrere Epics gleichzeitig entwickeln.

| Phase | User Stories | Ergebnis |
|---|---|---|
| 1 – Fundament | US-01, US-02, US-03, US-04, US-16 | Deploybare App, Erstinstallation, geschützter Login, Drei-Versuche-Sperre, Verschlüsselung |
| 2 – Stammdaten | US-05, US-06, US-07 | Feuerwehrstandort, Kinder, Fahrzeuge und Sitzplätze verwaltbar |
| 3 – Tagesübersicht | US-08, US-09, US-10 | Anwesende Kinder und verfügbare Fahrzeuge auswählbar; Eingaben valide |
| 4 – Routing | US-11, US-12 | Reale Fahrzeiten, vollständige und kapazitätskonforme Routenplanung |
| 5 – Ergebnis | US-13, US-14, US-15 | Verständliche Routen, Fahrzeugvergleich, nachvollziehbare Zeitersparnis, Neuberechnung |
| 6 – Absicherung | US-17, US-18, US-19 (begleitend ab Phase 1) | Datenschutz-/Betriebshinweise, Updatekonzept, automatisierte Tests |

**Definition of Done je Story:** Implementierung, notwendige Datenbankmigrationen, automatisierte Tests, Fehler- und Leerzustände, kurze Dokumentation und keine Regression bestehender Funktionen.

## 4. Technische Leitplanken

- **Architektur:** Responsives Webfrontend, Backend-API, relationale Datenbank und klar getrennte Routing-/Optimierungskomponente.
- **Persistenz:** Kinder, Fahrzeuge, Konfiguration und Benutzerkonten liegen in der Datenbank. Die Anwesenheit ist zunächst eine Tagesauswahl und muss nicht dauerhaft historisiert werden.
- **Routing vs. Optimierung:** Ein Routingdienst ermittelt Fahrzeiten und Straßenwege; ein Optimierungsalgorithmus entscheidet über Fahrzeugzuordnung und Reihenfolge. **Das sind getrennte Aufgaben.**
- **Algorithmus:** Für mehrere Fahrzeuge mit unterschiedlichen Kapazitäten ist ein *Capacitated Vehicle Routing Problem* mit heterogener Flotte zu lösen. Geeignete Technologien können z. B. OR-Tools oder ein Routing-/Optimierungsservice sein; die endgültige Auswahl wird im Architektur-Schritt getroffen.
- **Betrieb:** Bevorzugt Docker Compose mit Reverse Proxy, TLS und automatisierbaren, kontrollierten Updates. Falls Node.js/npm verwendet wird: minimale Abhängigkeiten, gepflegte LTS-Version, Lockfile, Dependency-Scanning.
- **Sicherheit:** Secrets nicht im Repository oder öffentlichen Webverzeichnis; Backend prüft jede Berechtigung unabhängig vom Frontend. Entschlüsselte personenbezogene Daten nur so lange wie nötig im Speicher halten.
- **Fehlertoleranz:** Keine Schätzwerte erfinden, wenn Routing oder Geokodierung fehlschlägt. Berechnungen mit fehlenden Zielen müssen abgefangen werden.
- **Bedienung:** Desktop und Smartphone; möglichst wenige Schritte zwischen „Kinder auswählen“ und „Route berechnen“.

## 5. Bewusst nicht Teil des ersten MVP

- Live-Tracking von Fahrzeugen oder Kindern.
- Automatischer Versand von Adressen oder Routen an externe Personen.
- Automatische Navigationsführung; zunächst reicht eine geordnete Stoppliste.
- Mehrmandantenfähigkeit, komplexe Rollenverwaltung oder Selbstregistrierung.
- Dauerhafte Speicherung sämtlicher historischer Heimfahrten.
- Verkehrsprognosen oder Echtzeitstau-Daten ohne tatsächlich angebundenen Anbieter.

## 6. Offene fachliche Entscheidungen

Diese Punkte lassen sich nach dem ersten MVP präzisieren, ohne die Grundarchitektur neu zu bauen:

1. Soll die **Fahrzeit bis zum letzten abgesetzten Kind** stets wichtiger sein als die **Summe der Fahrzeugfahrzeiten**? Das ist hier als Standard festgelegt.
2. Müssen **alle eingesetzten Fahrzeuge anschließend zur Feuerwehr zurückfahren**? Aktuell wird diese Rückfahrt separat ausgewiesen und nicht für die Heimbringzeit optimiert.
3. Gibt es eine **maximal verfügbare Gesamtzahl an Betreuern**? Bisher werden nur 1 oder 2 pro Fahrzeug eingestellt; die App begrenzt nicht die Gesamtzahl.
4. Sollen bei Geschwistern bzw. gleicher Adresse **gemeinsame Haltepunkte** angezeigt werden? Die Kinder müssen auch dann einzeln hinsichtlich Sitzplätzen berücksichtigt werden.
5. Soll die App **vollständig ohne externe Dienste** betrieben werden? Das bestimmt die Wahl des Geokodierungs- und Straßenroutingdienstes sowie benötigte Serverressourcen.
6. Ist eine **Kartenansicht** von Anfang an zwingend oder genügt zunächst eine geordnete, mobil nutzbare Stoppliste?
