# Benutzer verwalten

Administratoren sehen in der Navigation **Benutzer**. Dort lassen sich persönliche Konten anlegen, Passwörter zurücksetzen, Konten sperren/entsperren und Rollen ändern. Es gibt keine öffentliche Registrierung und keinen E-Mail-Versand.

| Rolle | Berechtigungen |
| --- | --- |
| Benutzer | Tagesplanung, Kinder, Fahrzeuge und Standort verwalten; CSV importieren/exportieren |
| Administrator | Zusätzlich alle Benutzerkonten verwalten |

## Neues Konto

**Benutzer → Benutzer anlegen** öffnen. Einen eindeutigen Benutzernamen (3–80 Zeichen), die Rolle und ein Passwort (12–128 Zeichen) eingeben und das Passwort wiederholen. Benutzernamen werden kleingeschrieben. Das Konto kann sich direkt auf der normalen Anmeldeseite anmelden. Zugangsdaten persönlich über einen geeigneten Kanal übergeben; die App versendet sie nicht. Es gibt keinen erzwungenen Passwortwechsel bei der ersten Anmeldung.

## Bestehende Konten

- **Passwort zurücksetzen:** Neues Passwort zweimal eingeben. Alle Sitzungen dieses Kontos werden beendet. Ein gesperrtes Konto bleibt gesperrt; bei Bedarf anschließend ausdrücklich entsperren. Beim Zurücksetzen des eigenen Passworts wird man abgemeldet.
- **Sperren:** Verhindert neue Anmeldungen und beendet bestehende Sitzungen.
- **Entsperren:** Hebt die Sperre auf, setzt Fehlversuche zurück und verlangt eine neue Anmeldung. Eine IP-Ratenbegrenzung läuft unabhängig davon ab.
- **Rolle ändern:** Benutzer zum Administrator machen oder Administrator zum Benutzer machen. Bestehende Sitzungen des Kontos werden beendet; die neue Rolle gilt bei der nächsten Anmeldung.

Das eigene Administratorkonto lässt sich hier weder sperren noch herabstufen. Parallele Verwaltungsänderungen werden serialisiert und die Rechte dabei erneut geprüft; mindestens ein aktiver Administrator bleibt erhalten. Nach drei falschen Passwörtern kann sich jedoch weiterhin auch der letzte Administrator aussperren. Für diesen Fall gibt es die gezielte [Datenbank-Entsperrung](betrieb.md#anmeldung-und-sperre).

Passwörter werden mit Argon2id gehasht und nicht angezeigt. Die Benutzerliste enthält nur ID, Benutzername, Rolle, Sperrstatus und Fehlversuchszähler. Nur Administratoren dürfen sie abrufen. Alle Änderungen erfordern eine gültige Sitzung und CSRF-Prüfung; die Prüfung erfolgt auch im Backend.

## Bestehende Installation aktualisieren

Die Migration `002_user_roles.sql` ergänzt die Rolle. Vorhandene Konten erhalten Administratorrechte; Passwörter, Schlüssel und Anwendungsdaten werden nicht ersetzt. Das tokengebundene Erstsetup erstellt bei neuen Installationen weiterhin das erste Administratorkonto.

Auf Plesk nach der Bereitstellung unter **Node.js → Skript ausführen** `migrate` eingeben und danach **App neu starten**. Mit dem bestehenden Konto anmelden; anschließend erscheint **Benutzer**. Für diese Erweiterung gibt es keine neuen npm-Abhängigkeiten. Ein funktionierender automatischer Deployment-Hook führt dieselbe Migration bereits aus.

Konten löschen und feinere Rollen für einzelne Stammdatenbereiche sind nicht Bestandteil dieser einfachen Verwaltung.
