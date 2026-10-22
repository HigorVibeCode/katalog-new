# Katalog Glas nach Mass – Büchler Glas

Statischer Katalog (Trennwand, Lavabo, Küchenrückwand) mit 3D-Szenen, Galerien, Vorher/Nachher und
Auswahl-Assistent, auf Deutsch (Schweiz), Französisch und Englisch.

## Seiten erzeugen

Die Seiten werden aus einer Vorlage gebaut; die erzeugten Dateien nie direkt bearbeiten.

```
python3 i18n/build.py
```

- `i18n/template.html` – die Seite (Englisch)
- `i18n/auswahl.json` – die Daten des Auswahl-Assistenten
- `i18n/de.json`, `i18n/fr.json` – Englisch → Deutsch (de-CH, ss statt ß) / Französisch

Ergebnis: `index.html` (Deutsch), `fr.html`, `en.html` und `auswahl.de.json`, `auswahl.fr.json`, `auswahl.en.json`.
Fehlt eine Übersetzung, bricht der Build ab und listet sie auf.

## Vercel

Framework Preset **Other**, kein Build Command, Output Directory `.`. Jeder Push auf `main` aktualisiert die Seite.

## Lokal ansehen

```
python3 -m http.server
```

Die 3D-Szenen laden three.js von jsDelivr; ohne Internet oder ohne WebGL2 zeigen sie die vorgerenderten Bilder.
Die technischen PDFs (`technik/`) gibt es vorerst nur auf Deutsch.
Die Seite ist mit `noindex` markiert, bis sie öffentlich beworben werden soll.
