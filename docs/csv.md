# CSV-Import und -Export

In **Kinder** und **Fahrzeuge** gibt es die Schaltflächen **CSV importieren**, **CSV exportieren** und **CSV-Vorlage**. Alle Funktionen benötigen eine Anmeldung. Exporte werden direkt als Download ausgeliefert; der Server legt keine Klartext-CSV-Datei ab. Ein heruntergeladener Kinderexport enthält Namen und Adressen und muss auf dem Endgerät entsprechend geschützt werden.

## Format

- UTF-8, wahlweise mit BOM; Exporte enthalten ein BOM für Excel.
- Semikolon oder Komma als Trennzeichen. Der Export verwendet Semikolon und CRLF.
- Kopfzeile erforderlich, höchstens 500 Datensätze und 1 MiB pro Datei.
- Anführungszeichen und mehrzeilige Felder werden unterstützt. `"` innerhalb eines gequoteten Felds wird als `""` geschrieben.
- Dezimalkomma ist bei Koordinaten in semikolongetrennten Dateien möglich, der Export schreibt Dezimalpunkte.
- Namen/Adressen mit Tabellenformel-Anfang werden beim Export mit einem Apostroph geschützt; beim Wiederimport eigener Exporte wird dieser Schutz reversibel entfernt.

Kinder:

```csv
id;name;address;lat;lon;confirmed
;Synthetic Example;Synthetic Test Road 10;49.8;8.7;true
;Another Synthetic Example;Another Synthetic Road 1;;;false
```

Die Beispiele sind synthetisch und keine Vorlage realer Kinderadressen. Pflichtspalten sind nur `name` und `address`. Fehlen Koordinaten oder ist `confirmed=false`, wird das Kind mit dem Hinweis **Adresse noch prüfen** angelegt. Vor seiner Routenberechnung muss die Adresse in der Kinderverwaltung über die Suche oder geprüfte manuelle Koordinaten bestätigt werden. Ein CSV-Import löst keine automatische Massen-Geokodierung bei Dritten aus.

`lat` und `lon` müssen gemeinsam gesetzt werden. `confirmed` akzeptiert `true/false`, `1/0`, `ja/nein` und `yes/no`; ohne Angabe gilt `false`. Ein Import mit `confirmed=true` ist nur mit vorhandenen gültigen Koordinaten als geprüft nutzbar. Die Bestätigung in der Vorschau bezieht sich auch auf die Richtigkeit so gekennzeichneter Adressen.

Fahrzeuge:

```csv
id;name;seats
;Synthetic MTF;9
;Synthetic PKW;5
```

`seats` ist die Gesamtzahl der zugelassenen Sitzplätze einschließlich Fahrer/Betreuern, ganzzahlig zwischen 1 und 100. Die Zahl der Betreuer wird weiterhin in der Tagesplanung ausgewählt.

Deutsche Kopfzeilen werden ebenfalls erkannt: `Name`, `Bezeichnung`, `Adresse`, `Breitengrad`, `Längengrad`, `Geprüft`, `Sitzplätze` sowie die Umlautumschreibungen `Laengengrad`, `Geprueft`, `Sitzplaetze`.

## Sicher übernehmen

1. CSV-Datei auswählen und **Vorschau laden** anklicken.
2. Anzahl neuer/geänderter Einträge, ausstehende Adressprüfungen und Fehler kontrollieren.
3. Bei Fehlern Datei korrigieren und Vorschau erneut laden. Es wird kein fehlerfreier Teil automatisch gespeichert.
4. Prüfung per Checkbox bestätigen und **Import bestätigen** anklicken.

Der komplette Import läuft innerhalb einer Datenbanktransaktion. Bei einem Fehler wird nichts übernommen. Ändert jemand nach der Vorschau Stammdaten, verlangt der Server eine neue Vorschau. Nach erfolgreichem Import werden vorhandene Routenergebnisse im aktuellen Browser verworfen.

## Aktualisieren und Datenbankwechsel

Eine vorhandene `id` aus einem Export bezeichnet genau den zu ändernden Datensatz. Eine gültige, bislang unbekannte ID wird als neuer Datensatz übernommen, damit Exporte in eine leere neue Installation eingelesen werden können. Die IDs bleiben so stabil. Keine IDs von Hand erfinden, wenn ein existierender Datensatz geändert werden soll.

Ohne ID wird ein vorhandenes Fahrzeug anhand seiner Bezeichnung erkannt, ein Kind anhand von Name **und** Adresse. Groß-/Kleinschreibung und mehrfacher Leerraum werden für diese Erkennung vereinheitlicht. Sind mehrere vorhandene Kinder damit identisch, muss die ID angegeben werden. Wiederholte Datensätze in derselben Datei und kollidierende Fahrzeugnamen werden als Fehler angezeigt.

Andere vorhandene Datensätze werden nie durch das Fehlen in einer CSV-Datei gelöscht. Ein Import ergänzt/aktualisiert, er ersetzt nicht pauschal die gesamte Tabelle. Für eine Adressänderung eines vorhandenen Kindes deshalb dessen exportierte ID beibehalten.

Beim Wechsel zwischen PostgreSQL und MariaDB erst Kinder/Fahrzeuge exportieren, dann eine neue Installation mit neuer Datenbank einrichten, Standort festlegen und beide Dateien importieren. Konto, Setupstatus, Schlüssel und Feuerwehrstandort sind kein Bestandteil dieser CSV-Dateien. Ein vollständiges Backup bleibt ein datenbankspezifischer separater Vorgang.
