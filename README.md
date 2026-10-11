# Bienen Doku

Offlinefähige Imkerei-Dokumentation mit sprachgeführter Durchsicht, lokalen Belegen, PDF-Ausgabe, Sicherung und optional verschlüsseltem Geräteabgleich.

Erstellt von T. Kruska / Bienen Kruska.

Öffentliche App: https://bienen-doku-pflicht.kramer250.chatgpt.site

GitHub-Export des gespeicherten App-Stands 45. Diese Veröffentlichung verändert
die bestehende App und ihre Browserdaten nicht. Der Paketversionswert 0.1.0
wurde aus dem Originalprojekt übernommen; der Release-Tag lautet `site-v45`.

Die Startübersicht enthält Jahreszähler für alle Dokumentationsarten sowie die
aktuelle Grünlandtemperatursumme für die vom Nutzer gewählte deutsche PLZ.

Erstellt von **T. Kruska** und veröffentlicht unter der MIT-Lizenz.

Bienen Doku ist eine Offline-First-Web-App für die Imkerei-Dokumentation
in Deutschland. Einträge, Stammdaten und Belegdateien werden im Browser gespeichert. Bei freiwillig
aktiviertem Geräteabgleich werden verschlüsselte Sicherungen an den Sync-Server
übertragen. Es gibt kein App-Benutzerkonto und keine eingebauten Tracking-Skripte.

> Die Software ist eine Dokumentationshilfe und keine Rechtsberatung. Maßgeblich
> sind die aktuelle Zulassung und Packungsbeilage, der amtliche Wortlaut sowie
> Vorgaben der zuständigen Behörde.

## Funktionen

- offline nutzbare Progressive Web App (PWA)
- lokale Speicherung in IndexedDB, einschließlich Belegen und Rechnungen
- Mehrfachauswahl mit sichtbarer Dateiliste vor dem Speichern und Anzeige aller
  Anhänge in der Detailansicht
- versionierter Online-Abgleich ausschließlich für Richtlinien, zugelassene
  Varroamittel und Behandlungsmethoden
- Offline-Rückfall auf den zuletzt gespeicherten Prüfkatalog
- Pflichtfelder für Arzneimittel-Aufzeichnungen nach Art. 108 VO (EU) 2019/6
- Dropdown mit 21 Präparaten der amtlichen LWG-Übersicht, Produktlistenstand Juni 2025
- Plausibilitätsprüfung für Datum, Menge, Völkerzahl, Wartezeit für Honig und Präparat
- getrennte Erfassung von Wartezeit, Behandlungsdauer sowie Tracht-/Honigraumvorgaben
- mittelabhängige Darreichungsformen, Einheiten und Behandlungsabläufe statt pauschaler ml-Angaben
- Streifenwechsel, Wiederholungsdaten, Entnahme, Applikationshilfe und Anwendungsart passend zum Präparat
- Stornierung von Arzneimittel-Nachweisen unter Erhalt des Originals
- Dokumentation von Völkern, Ständen, Durchsichten, Ernten, Fütterung, Hygiene
  und Tierseuchenhinweisen
- vollständiges JSON-Backup mit Einträgen und Belegdateien
- automatische Sicherung nach jeder Änderung in eine Datei außerhalb der Browserdaten
- vollständige A4-Gesamtdokumentation zum Drucken oder Speichern als PDF
- integriertes, offline verfügbares und als PDF druckbares Bedienungshandbuch
- Schnellstart-Dialog beim ersten Öffnen mit direktem Weg zu Sicherung und Handbuch
- Wiederherstellung und CSV-Export
- responsive Oberfläche für Smartphone, Tablet und Desktop
- automatische Aktualisierung bereits installierter Apps beim nächsten Online-Öffnen
- freiwilliger, vollautomatischer Geräteabgleich zwischen Smartphone und PC
  mit clientseitiger AES-GCM-Verschlüsselung und persönlichem Sync-Code
- automatischer Katalogabgleich beim Online-Start, bei Rückkehr in die App und
  zusätzlich alle sechs Stunden; sichtbares Prüf- und Fälligkeitsdatum
- deutliche Überfälligkeitswarnung, falls die kontrollierte fachliche Prüfung
  nicht innerhalb von 30 Tagen erneuert wurde

## Datenschutz und Speicherort

Die persönlichen Daten liegen in der IndexedDB des verwendeten Browsers. Ohne
aktivierten Geräteabgleich werden sie nicht an den App-Server übertragen. Unterschiedliche Geräte, Browser und
Browserprofile besitzen voneinander getrennte Datenbestände.

Browserdaten können verloren gehen, wenn Website-Daten, das Browserprofil oder
die installierte PWA gelöscht werden. Deshalb sollte regelmäßig unter
**Export → Vollständiges Backup** eine Sicherung außerhalb des Browsers erstellt
werden. Das Backup enthält auch hochgeladene Belege.

Unter **Export → Auto-Sicherung** kann einmal ein Speicherziel gewählt werden.
Unterstützte Browser überschreiben danach nach jeder Änderung dieselbe
Sicherungsdatei. Browser ohne direkten Dateizugriff verwenden den
Download-Modus und legen nach Änderungen neue Sicherungen im Download-Ordner
an. Die Sicherungsdatei bleibt erhalten, wenn Browser- oder App-Daten gelöscht
werden; anschließend kann sie über **Sicherung einspielen** zurückgeladen werden.

Die **Gesamtdokumentation** erzeugt eine druckoptimierte A4-Ausgabe mit
Titelblatt, Inhaltsübersicht, allen Datensätzen, Pflichtfeldern, Stornierungen
und den Namen hinterlegter Belege. Im Druckdialog lässt sie sich als PDF
speichern.

## Online-Prüfkatalog

`public/data/compliance-catalog.json` ist der einzige fachliche Online-Datensatz,
den die laufende App abgleicht. Er enthält:

- Katalogversion und Prüfdatum
- Varroapräparate aus der amtlichen LWG-Übersicht (mit sichtbarem Produktlistenstand)
- allgemeine Behandlungsmethoden ohne Dosierungsanweisung
- Links zu den amtlichen Quellen

Der Service Worker verwendet für den Katalog „network first“ und hält die letzte
gültige Version offline vor. Anwendungsdaten werden weder vom Service Worker
noch von einer API übertragen.

Bereits installierte Apps prüfen beim nächsten Online-Öffnen auf eine neue
Version. Eine aktualisierte App-Oberfläche und Formlogik wird automatisch
übernommen; lokale Einträge, Belege und Sicherungseinstellungen bleiben erhalten.

Die App prüft eine veröffentlichte Katalogdatei automatisch, interpretiert
Gesetzesänderungen jedoch nicht selbst. Fachliche Änderungen werden anhand der
amtlichen Quellen kontrolliert, als neue Katalogversion veröffentlicht und dann
von allen Online-Geräten übernommen. Ein sichtbares Fälligkeitsdatum und eine
Warnung verhindern, dass ein alter Stand unbemerkt als aktuell erscheint.

## Installation als PWA

1. Die bereitgestellte URL einmal online in Chrome, Edge oder Safari öffnen.
2. Im Browser **App installieren**, **Zum Startbildschirm** oder
   **Zum Home-Bildschirm** wählen.
3. Die App einmal vollständig laden lassen. Danach kann sie offline geöffnet und
   verwendet werden.

Alternativ lässt sich das Projekt lokal ausführen:

```bash
npm ci
npm run dev
```

Voraussetzung: Node.js `>=22.13.0`. Für die Cloudflare-Befehle mit
Umgebungsvariablen wird eine POSIX-Shell (Linux, macOS oder WSL) benötigt.

```bash
git clone https://github.com/Kt311/bienen-doku.git
cd bienen-doku
npm ci
npm test
```

GitHub Actions prüft Installation, Build und den vorhandenen HTML-Smoke-Test.
Das ist kein vollständiger Test von PWA, Sprachsteuerung, Geräteabgleich oder
fachlichen Inhalten. Ein Quellcode-Release aktualisiert den Prüfkatalog nicht.

## Eigenständig bei Cloudflare veröffentlichen

Für den unabhängigen Betrieb wird **Cloudflare Workers mit Static Assets** zur
Auslieferung der App verwendet. Der freiwillige, verschlüsselte Geräteabgleich
liegt in einem privaten **R2-Bucket**. D1, KV, Pages und Cloudflare Images werden
für den aktuellen Funktionsumfang nicht benötigt.

Die Produktionswerte stehen in `wrangler.jsonc` unter `env.production`. Der
R2-Bucket ist auf die EU-Jurisdiktion festgelegt und bleibt ohne öffentliche
R2-Adresse ausschließlich über den Worker erreichbar.

Einmalige Einrichtung im Projektordner:

```bash
npx wrangler login --device
npm run cloudflare:whoami
npx wrangler r2 bucket create bienen-doku-pflicht-sync --jurisdiction eu
npm run cloudflare:types
npm run deploy:cloudflare:dry-run
npm run deploy:cloudflare
```

`deploy:cloudflare:dry-run` baut und prüft das vollständige Paket, ohne es zu
veröffentlichen. `deploy:cloudflare` veröffentlicht anschließend denselben
Produktionsaufbau im verbundenen Cloudflare-Konto. Geheimnisse gehören nicht in
`wrangler.jsonc`; lokale Geheimnisse würden in einer nicht eingecheckten
`.dev.vars`-Datei liegen.

## Bedienungsanleitung

In der App öffnet **Hilfe → Hilfe & Handbuch** die vollständige Anleitung. Sie
beschreibt Installation, erste Einrichtung, Einträge und Belege, Sicherung,
Wiederherstellung, PDF-Ausgabe, Weitergabe der App und Problemlösung. Über
**Handbuch drucken / als PDF** kann sie archiviert oder weitergegeben werden.
Beim ersten Öffnen zeigt die App zusätzlich einen kompakten Schnellstart. Er kann
für das aktuelle Öffnen geschlossen oder dauerhaft ausgeblendet und unter
**Hilfe → Schnellstart anzeigen** jederzeit wieder aufgerufen werden.

Eine ausführliche Textfassung liegt zusätzlich in [`HANDBUCH.md`](HANDBUCH.md).

## Weitergabe

Nach öffentlicher Freigabe kann derselbe App-Link weitergegeben werden. Der Link
verteilt ausschließlich die Anwendung: Jede Person erhält in ihrem Browser einen
eigenen lokalen Datenbestand. Einträge, Belege und Sicherungen des Erstellers
werden nicht mitgeteilt oder synchronisiert.

## Technik

- React 19, TypeScript, Next/Vinext und Vite
- IndexedDB für lokale Datensätze und Blobs
- Web App Manifest und Service Worker für den Offline-Betrieb
- Cloudflare Worker nur zur Auslieferung der statischen App und des Prüfkatalogs
- verschlüsselter R2-Sync-Speicher nur bei freiwillig aktivierter Gerätekopplung
- keine Analyse- oder Werbeskripte

## Automatische Gerätesynchronisierung

Unter **Export → Smartphone & PC automatisch abgleichen** kann ein Gerät einen
langen zufälligen Sync-Code erzeugen. Derselbe Code wird einmalig auf dem zweiten
Gerät eingegeben. Danach zieht die App bei Internetverbindung automatisch den
verschlüsselten Stand, führt neuere Datensätze zusammen und lädt die gemeinsame
Fassung wieder verschlüsselt hoch. Der Abgleich erfolgt nach Änderungen und
zusätzlich regelmäßig; offline bleibt die App vollständig nutzbar.

Die Sicherung wird vor dem Upload im Browser mit AES-GCM verschlüsselt. Der
Server erhält weder Klartextdaten noch Dateinamen oder Beleginhalte. Der
Sync-Code ist der Entschlüsselungsschlüssel und muss daher wie ein Passwort
behandelt und außerhalb der App sicher verwahrt werden. Das Ausschalten der
Synchronisierung entfernt den Code nur vom jeweiligen Gerät; lokale Daten
bleiben bestehen.

## Prüf- und Build-Befehle

```bash
npm run lint
npm test
npm run build
```

## Amtliche Quellen

- Art. 108 VO (EU) 2019/6 – Arzneimittel-Aufzeichnungen und fünfjährige Bereithaltung
- Anhang I VO (EG) 852/2004 – Primärproduktion und Buchführung
- Art. 18 VO (EG) 178/2002 – Rückverfolgbarkeit
- § 1a Bienenseuchen-Verordnung – Anzeige der Bienenhaltung
- Tierseuchenmeldeverordnung 2026 – Meldepflichten und Meldeinhalt
- LWG Bayern – „Zugelassene Varroamittel“, Produktlistenstand Juni 2025
- EU Union Product Database – aktueller Zulassungsabgleich
- LAVES – Hinweise zur Tierarzneimittelanwendung und Restentmilbung

## Katalogpflege

Bei einer Aktualisierung zuerst die amtlichen Quellen prüfen. Danach
`public/data/compliance-catalog.json` und den identischen Fallback in
`lib/varroa-products.ts` aktualisieren, `version` erhöhen, `verifiedAt` setzen
und die Tests ausführen. Dosierungen gehören nicht in den Katalog; hierfür gilt
die jeweilige Packungsbeilage.

## Lizenz

MIT – siehe `LICENSE`.

## Herkunft des GitHub-Exports

Gespeicherter App-Stand: 45. Quellcommit: `290ff825150e3b8274b4d9f456e934a687c3c5e4`.
Entfernt wurden die interne Hosting-Kennung und umgebungsspezifische
Installationsskripte. Die npm-Befehle nutzen direkt die gesperrten Abhängigkeiten.
Eine GitHub-Actions-Prüfung wurde ergänzt. Anwendungslogik und Katalog wurden
für diesen Export nicht verändert. Fremde Marken und Logos verbleiben bei ihren
jeweiligen Rechteinhabern; die MIT-Lizenz überträgt keine Markenrechte.
