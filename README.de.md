<div align="center">

<img src="./easy-speak/public/favicon.svg" width="76" height="76" alt="EasySpeak" />

# EasySpeak · 轻松说

[简体中文](./README.md) · [English](./README.en.md) · [日本語](./README.ja.md) · [한국어](./README.ko.md) · [Español](./README.es.md) · [Français](./README.fr.md) · **Deutsch**

**Übe deine Wunschsprache so natürlich wie in einem Gespräch mit Freunden.**

</div>

EasySpeak (轻松说) ist eine für Mobilgeräte gestaltete KI-Web-App zum Sprechtraining für Erwachsene. Ein Hauptpartner führt das Gespräch. Zwei feste Hilfebereiche arbeiten unabhängig: oben stehen Anregungen für deine nächste Antwort, unten Rückmeldungen ausschließlich zu deiner letzten Äußerung.

> **Open Source unter der [Apache License 2.0](./LICENSE). Kommerzielle Nutzung, Änderungen und Weitergabe sind unter ihren Bedingungen erlaubt.** Erforderliche Lizenz- und Urheberhinweise müssen erhalten und Änderungen gekennzeichnet werden. Abhängigkeiten behalten ihre eigenen Lizenzen.

Über die Links oben wechselst du die README-Sprache. Die ausführliche technische Dokumentation ist derzeit überwiegend auf Chinesisch.

## Funktionen

- **Natürliches Sprechen:** Halbduplex mit abwechselnden Beiträgen; das Mikrofon wird nach der KI-Ausgabe geöffnet. Spracherkennung, gestreamte Antworten und Sprachausgabe sind verbunden. Texteingabe ist ebenfalls möglich.
- **Zwei unabhängige Hilfen:** oben Ideen, Formulierungen und aufklappbare Beispielsätze; unten Feedback zum letzten Nutzerbeitrag. Beide Bereiche lassen sich getrennt aktualisieren und erneut anfordern.
- **Sprachen und Niveau:** vertraute Sprache und Übungssprache auswählen, tauschen oder Sprachcodes eingeben. A1–C1 dient als Orientierung für die Schwierigkeit.
- **Eigene Übungen:** Situation frei beschreiben und Artikel, Lebenslauf, Wortschatz oder andere Materialien hinzufügen. Importe vor der Übernahme prüfen und Vorlagen speichern.
- **Dateien und Bilder:** TXT, Markdown, CSV, Text-PDF, DOCX, PNG, JPG und WebP. Dokumenttext wird lokal extrahiert; ausgewählte Bilder benötigen ein Modell mit Bildverständnis.
- **Anbieter:** MiniMax, DeepSeek, OpenAI, Qwen und eigene Chat-Completions-kompatible APIs. Die Hilfen können eigene Modell-IDs beim gleichen Gesprächsanbieter mit demselben Schlüssel nutzen.
- **Stimmen und Pausen:** zwölf benannte MiniMax-Stimmen mit Vorschau, Gerätestimmen, eigene Stimmen-IDs und zwei, drei oder fünf Sekunden Wartezeit.
- **Lernen und Wiederholen:** zwölf Kommunikationsaufgaben, gespeicherte Ausdrücke, Korrektursammlung, zeitversetzte Wiederholung, Ziele und Statistiken pro Sprachpaar. Vier Designs, ausblendbare Untertitel, Übersetzung auf Anfrage, erneutes Üben nach Korrektur und Textexport.

**Die Kamera zeigt nur eine lokale Vorschau. Die KI erhält keine Kamerabilder.** Live-Videoverständnis ist nicht implementiert. Das Lesen eines selbst ausgewählten Bildes in eigenen Übungen ist ein separater, ausdrücklicher Upload.

## Schnellstart

Voraussetzungen: Node.js ab 22.13 (24 empfohlen), npm und ein moderner Browser. Für die Browser-Spracherkennung werden Chrome / Edge empfohlen; verfügbare Sprachen hängen vom Dienst ab.

Im Stammverzeichnis des Repositorys:

```sh
cd easy-speak
npm ci --cache .npm-cache
npm run dev
```

Öffne die angezeigte Adresse, normalerweise <http://127.0.0.1:5173/>.

1. Wähle rechts oben in den Einstellungen einen Anbieter und trage Base URL, deinen API-Schlüssel und die Modell-ID ein.
2. Wähle Browser-Erkennung / Gerätestimme oder richte MiniMax ASR / TTS in den Spracheinstellungen ein.
3. Erlaube den Mikrofonzugriff und sprich nach dem Gesprächspartner. Bei blockierten Berechtigungen oder Audio den Hinweisen folgen oder tippen.
4. Wechsle oben Sprachpaar oder Situation. Eigene Übungen befinden sich in der Situationsauswahl.

Ohne Schlüssel gibt es nur eine gekennzeichnete lokale Demo für Englisch mit chinesischer Unterstützung. Andere Sprachpaare, eigene Übungen und echte KI-Antworten erfordern einen Anbieter. Gemeinsame Schlüssel oder kostenlose API-Kontingente sind nicht enthalten; Kosten entstehen bei deinem Anbieteraccount.

### Optional: lokaler MiniMax-Proxy

Kopiere im Anwendungsverzeichnis die Beispielkonfiguration:

```sh
# macOS / Linux
cp .env.example .env.local
```

```powershell
# Windows PowerShell
Copy-Item .env.example .env.local
```

Setze MINIMAX_API_KEY in .env.local und starte den Entwicklungsserver neu. Nutze für Geheimnisse kein VITE_-Präfix und committe .env.local nicht. Der Browser erhält nur Verbindungsstatus und Platzhalter.

Der Proxy erlaubt nur Loopback-Zugriff und dient der lokalen Entwicklung. Er ist nicht im statischen Hosting enthalten und kein öffentlicher gemeinsamer Backenddienst. Siehe [Anbieter](./easy-speak/docs/providers.md).

Unter Windows kannst du nach der Installation der Abhängigkeiten vom Repository-Stamm aus im Hintergrund starten:

```powershell
.\Start-EasySpeak.ps1
```

Das Skript verwendet einen funktionierenden Server weiter oder startet ihn ohne Fenster; Protokolle bleiben im Projekt. Es richtet keinen Windows-Autostart ein.

## Architektur, Berechtigungen und Datenschutz

Die Sprachverarbeitung folgt **ASR → Sprachmodell → TTS**. Hauptantwort und Rückmeldung laufen parallel; die nächste Antwortanregung folgt nach der Hauptantwort. Abbruch und Versionsprüfung verhindern, dass alte Ergebnisse neue Gespräche überschreiben.

- Das Mikrofon ist für Spracheingaben nötig. MiniMax ASR erhält die aktuelle Aufnahme; Browser-Erkennung unterliegt dem jeweiligen Browser und Dienst.
- Die Kamera ist optional und lokal, ohne Aufnahme oder Bild-Upload. Schließen, Gesprächsende oder Wechsel in den Hintergrund geben sie frei.
- Nur ausgewählte Dateien werden gelesen. Dokumente werden lokal verarbeitet; Bildverständnis überträgt ein komprimiertes Bild. Übernommener Text wird beim Übungsbeginn an das Modell gesendet.
- Direkte API-Schlüssel liegen im sessionStorage des Tabs, nicht in einem sicheren Gerätetresor. Proxy-Schlüssel bleiben in der ignorierten .env.local; dauerhafte Einstellungen und Exporte enthalten keine Schlüssel.
- Verlauf, Ausdrücke und ausdrücklich gespeicherte Vorlagen bleiben im aktuellen Browser. Es gibt keine Konten oder Cloud-Synchronisierung; vor dem Löschen der Browserdaten exportieren.

## Entwicklung und Dokumentation

Die Anwendung liegt in easy-speak/. src/ enthält Komponenten, Hooks und Module; server/ den lokalen Proxy und Build-Prüfungen; tests/ und docs/ Tests und Spezifikationen. Vorhandene Browser-Speicherschlüssel bleiben kompatibel.

Im Anwendungsverzeichnis ausführen:

```sh
npm run format:check
npm run lint
npm test
npm run build
npm run preview
```

Der Build liegt in easy-speak/dist; preview ist nur zur lokalen Prüfung gedacht. Erzeuge vom Repository-Stamm aus ein Quellcodearchiv:

```powershell
.\Export-EasySpeak.ps1
```

release/easy-speak-source.zip enthält ausschließlich aufgelistete Dateien, geprüft auf bekannte Schlüssel und übliche Geheimnisformate. Private Umgebungsdateien, Abhängigkeiten, Caches, Protokolle, Builds und Browser-Lerndaten sind ausgeschlossen. Das Skript lädt nichts hoch.

[Funktionen](./easy-speak/docs/features.md) · [Architektur](./easy-speak/docs/architecture.md) · [Eigene Übungen](./easy-speak/docs/custom-training.md) · [Sprachen](./easy-speak/docs/languages.md) · [Stimmen](./easy-speak/docs/voices.md) · [Lernen](./easy-speak/docs/learning.md) · [Berechtigungen](./easy-speak/docs/permissions.md) · [Paketierung](./easy-speak/docs/packaging.md) · [Deployment](./easy-speak/DEPLOYMENT.md) · [Sicherheit](./easy-speak/docs/security-review.md) · [Prüfprotokoll](./easy-speak/docs/verification.md)

Aktuell ist dies eine Web-App ohne fertige APK / IPA oder natives Mobilprojekt. Audio, Bluetooth und Hintergrundwechsel erfordern Gerätetests. Authentifizierung, Nutzerkontingente und gemeinsame Abrechnungssicherheit für ein öffentliches Backend fehlen. Modell-, Sprach-, Stimmen- und CORS-Unterstützung hängen vom Anbieter ab. Feedback beruht auf Texttranskripten und misst weder Aussprache noch tatsächliche Sprechflüssigkeit.

## Beiträge und Lizenz

Beachte die [Entwicklungsregeln](./easy-speak/CONTRIBUTING.md) und [Sicherheitsmeldungen](./SECURITY.md). Entferne Schlüssel und private Materialien aus Berichten.

Die ursprünglichen Projektteile stehen unter der [Apache License 2.0](./LICENSE). Kommerzielle Nutzung, Änderungen und Weitergabe sind erlaubt. Anwendbare [NOTICE](./NOTICE)- und Urheberhinweise erhalten, die Lizenz beilegen und Änderungen kennzeichnen. Markenrechte und Gewährleistung werden nicht gewährt; maßgeblich ist der englische Lizenztext. Siehe [Drittanbieterhinweise](./THIRD_PARTY_NOTICES.md).
