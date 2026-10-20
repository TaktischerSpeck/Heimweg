# Straßenrouting und Optimierung

## Ohne eigenen Kartenserver: OpenRouteService aus Node

Die Node-App kann Adresssuche und Straßenmatrizen direkt über einen freigegebenen OpenRouteService-Account abrufen. Dafür in der privaten `.env` konfigurieren:

```dotenv
MAP_PROVIDER=ors
PROVIDER_MODE=external
ALLOW_EXTERNAL_LOCATION_DATA=true
ORS_URL=https://api.openrouteservice.org
ORS_API_KEY="euer-api-schluessel"
```

Es wird kein zusätzliches Kartenpaket im Browser geladen. Die Node-App sendet Adressen an `/geocode/search` und Koordinaten als POST an `/v2/matrix/driving-car`. Ein API-Schlüssel sowie ausreichende Anbieter-Kontingente sind erforderlich. Der Anbieter erhält Adressen/Koordinaten; Namen werden nicht übertragen. Schlüssel, Antworten und vollständige URLs landen nicht in den App-Logs. Die ORS-Geokodierung enthält den API-Schlüssel im serverseitigen Queryparameter; auch vorgeschaltete Egress-Proxys dürfen diese URLs nicht protokollieren.

Die Anbindung enthält keinen Offline-Straßendatensatz in Node. Eine Node-Bibliothek allein ersetzt keine gepflegten Straßen-/Adressdaten und Routing-Engine. Wer alle Standortdaten vollständig selbst verarbeiten möchte, betreibt weiterhin eigene OSRM-/Nominatim-Dienste. Der ORS-Adapter ist für gehosteten Betrieb im Modus `external` vorgesehen; die OpenRouteService-Backendinstallation allein enthält nicht automatisch dessen gehostete Geokodierung.

Grenzen/Kontingente des API-Tarifs vor Nutzung prüfen. Bei Fehlern, erschöpftem Kontingent oder nicht erreichbaren Orten wird keine Entfernung geschätzt. Die Matrix ist weiterhin die Grundlage derselben lokalen Optimierung und Fahrzeugvergleiche. Für diesen Adapter wurde das API-Format automatisiert mit synthetischen Antworten geprüft; ein Test mit dem eigenen Account erfolgt nach Konfiguration.

Quellen: [OpenRouteService Matrix](https://giscience.github.io/openrouteservice/api-reference/endpoints/matrix/), [API-Übersicht](https://openrouteservice.org/dev/), [Anbieterlimits](https://openrouteservice.org/restrictions/).


## Zwei getrennte Aufgaben

Nominatim übersetzt eine Adresse in mögliche Koordinaten. Der Benutzer wählt einen Treffer, prüft ihn und kann die Koordinaten korrigieren. Mehrdeutige Suchtreffer werden nicht automatisch gespeichert. Ohne Geocoder können **bereits anderweitig geprüfte** Koordinaten manuell eingetragen und bestätigt werden. Die Bestätigung ersetzt keine eigenständige Prüfung des tatsächlichen Ausstiegsorts.

OSRM berechnet eine gerichtete Fahrzeit- und Distanzmatrix zwischen Feuerwehr und allen ausgewählten Kindern. Die Reihenfolge der Koordinaten wird beibehalten. Die Anfrage verlangt `annotations=duration,distance`; Luftlinien-Fallbacks werden nicht verwendet. Ungültige Matrizen, `null`, fehlende Teilstrecken und vom Provider ausgewiesene Fallback-Werte führen zu einem Fehler. Das Zuordnen eines Punktes zu einer Straße ist auf 500 m begrenzt. Auch eine erfolgreich geroutete Koordinate sollte bei der Stammdatenanlage fachlich geprüft sein.

Erst danach entscheidet die Optimierung über Fahrzeugauswahl, Kinderzuordnung und Reihenfolge. Adressen werden nicht nach Luftlinie sortiert. Straßenrichtung und unterschiedliche Hin-/Rückwege werden berücksichtigt.

## Dienste betreiben

Die App liefert Adapter für **OSRM Table API** und **Nominatim Search API**. Eigene Dienste sind sinnvoll, wenn Adressen und Koordinaten das eigene System nicht verlassen sollen. Ihre URLs werden nur beim Deployment konfiguriert; Benutzer können keine beliebigen Backend-Ziel-URLs eingeben. Weiterleitungen von Provideranfragen werden abgelehnt, Anfragen nach 20 Sekunden abgebrochen.

Die Kartendienste benötigen separat importierte OpenStreetMap-Daten für die Region, Updates, ausreichenden Speicher und geschützte Netzverbindungen. Für OSRM müssen die vorbereiteten Daten das Fahrprofil `driving` und eine Table-Größe von mindestens 41 Punkten sowie Distanz-Annotationen unterstützen. Nominatim benötigt die Search-Schnittstelle mit `format=jsonv2`. Ein eigener Reverse Proxy kann Anbieter-Authentifizierung übernehmen; API-Schlüssel dürfen nicht im Browser landen. Für APIs mit anderem Requestformat ist eine Adaptererweiterung erforderlich.

Die App enthält bewusst keine ungefragte Nutzung öffentlicher OSRM-/Nominatim-Demodienste. Externe Dienste müssen explizit freigegeben sein. Bei externem Betrieb entstehen folgende Übertragungen:

| Funktion | Daten |
| --- | --- |
| Adresse suchen | Eingegebene Adresse, kein Kindername |
| Routen berechnen | Koordinaten des Standorts und ausgewählter Kinder, keine Namen |
| Routen darstellen | Keine zusätzliche Übertragung, reine lokale Stoppliste |

Koordinaten können ebenfalls personenbezogen sein. Anbieterbedingungen, Speicherdauer, Standort und zulässige Nutzung sind vom Betreiber zu prüfen. Das Setzen von `self-hosted` ist eine Betreibererklärung, keine automatische Netzwerkkontrolle. Nur tatsächliche eigene Endpunkte so kennzeichnen. Logs der Kartendienste dürfen keine vollständigen Such-URLs oder Koordinaten sammeln.

## Zielfunktion

1. Minimale Zeit bis zur Ankunft des letzten Kindes.
2. Bei gleicher Heimbringzeit minimale Summe der reinen Fahrzeiten.
3. Bei weiterer Gleichheit möglichst wenige eingesetzte Fahrzeuge.

Die Gleichheit wird numerisch mit minimaler Rundungstoleranz verglichen; es gibt im MVP keinen fachlichen Toleranzbereich von mehreren Minuten. Deshalb kann bereits eine kleine frühere letzte Ankunft zur Empfehlung eines weiteren Fahrzeugs führen. Die Vergleichstabelle macht den zusätzlichen Aufwand sichtbar, sodass Betreuer bewusst eine andere gültige Variante auswählen können.

Für jede mögliche Zahl tatsächlich eingesetzter Fahrzeuge wird eine eigene Variante gesucht. Fahrzeuge haben `Sitzplätze - Betreuer` Kinderplätze; 1 oder 2 Betreuer enthalten bereits den Fahrer. Ein eingesetztes Fahrzeug muss mindestens ein Kind befördern. Eine Variante mit zu wenig Gesamtkapazität oder mehr Fahrzeugen als Kindern ist nicht möglich.

Die Referenz ist die berechnete gültige Variante mit der kleinsten Fahrzeuganzahl, **ebenfalls optimiert**. Ersparnisse sind `Referenz - Variante`, separat für späteste Kinderankunft und gesamte Fahrzeit, in Minuten und Prozent. Negative Werte bedeuten Mehraufwand. Bei einer Referenz von null Sekunden wird kein Prozentwert erfunden. Bei nur einer gültigen Variante wird keine Zeitersparnis behauptet.

## Algorithmus

Bis 9 Kinder: Held-Karp-Dynamik berechnet für jede Teilmenge den schnellsten offenen Straßenweg. Eine Kapazitäts- und Fahrzeugzahl-Dynamik sucht per Schwellenwertsuche die kleinste mögliche maximale Routendauer. Innerhalb dieser Schwelle minimiert sie die gesamte Routendauer. Anschließend wird über die Fahrzeuganzahl verglichen. Das liefert die optimale Lösung der beschriebenen **Matrix-Zielfunktion**, keine Garantie für reale Verkehrslage. Ein erschöpfender Test prüft das Ergebnis an einem kleinen asymmetrischen Problem.

Ab 10 Kindern: Die App prüft kapazitätsgeeignete Fahrzeugkombinationen, baut vier deterministische Startlösungen auf und verbessert sie durch Reihenfolgeumkehr, Verschieben zwischen Fahrzeugen und paarweisen Austausch. Jede Änderung wird anhand der lexikografischen Zielfunktion bewertet. Die Suche ist deutlich mehr als Nearest Neighbor; eine globale Optimalitätsgarantie gibt es hier nicht. Die Oberfläche nennt das Ergebnis deshalb „Beste gefundene Lösung“.

Alle berechneten Lösungen werden auf vollständige, eindeutige Kinderzuordnung und Kapazitätsgrenzen geprüft. Die Suche verwendet feste Iterationsregeln und keinen Zufallsseed oder zeitabhängigen Stopp innerhalb des Algorithmus. Identische normalisierte Eingaben und identische Matrizen liefern identische Zuordnungen. Kinder und Fahrzeuge werden vor der Berechnung stabil sortiert.

Die einstellbare Rechenzeit begrenzt den gesamten Worker. Wenn die deterministische Suche diese Grenze überschreitet, wird ein klarer Fehler ausgegeben und keine neue Planung übernommen. Es werden bewusst keine hardwareabhängig wechselnden Teillösungen veröffentlicht. Eine zuvor angezeigte, unveränderte Planung bleibt bestehen; bei geänderten Eingaben bleibt sie als veraltet gekennzeichnet. Die Laufzeit des Provideraufrufs zählt separat (maximal 20 Sekunden). Der Proxy benötigt mindestens 70 Sekunden Timeout.

## Ankunftszeiten und Rückfahrt

Alle Fahrzeuge fahren gleichzeitig zum gewählten Zeitpunkt am Standort los. Bei leerer Abfahrtszeit wird der Zeitpunkt der Berechnungsanfrage verwendet. Angezeigte Uhrzeiten entsprechen der lokalen Zeitzone des Browsers. Das Backend rechnet mit UTC-Zeitstempeln.

Optional werden 0, 30, 60 oder 120 Sekunden Ausstiegszeit je Kind angesetzt. Diese Zeit wird vor dem jeweils nächsten Straßenabschnitt addiert. Die Ankunft des letzten Kindes enthält dessen anschließenden Ausstieg nicht. Die reine Gesamtfahrzeit enthält keine Ausstiegszeiten. Kinder an derselben Adresse bleiben jeweils einzelne Sitzplatzbelegungen und Stoppeinträge; bei Ausstiegszeit wird jedes Kind separat gezählt.

Die optionale Rückfahrt beginnt nach dem letzten Ausstieg. Sie verwendet die gerichtete Straßenmatrix zurück zur Feuerwehr und wird zusätzlich ausgewiesen. Sie ist **weder** Bestandteil des Optimierungsziels **noch** der Vergleichstabelle. Ohne aktivierte Option endet die Anzeige am letzten Kind.

Keine Live-Verkehrsdaten, Kartenansicht, Navigationsübergabe, garantierten Zustellzeiten oder tatsächliche Fahrzeugverfolgung.

## Schnittstellenreferenzen

- [OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/)
- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/)
- [node-postgres Verbindungen](https://node-postgres.com/features/connecting)
