# Katalog Glas nach Mass – Büchler Glas

Statischer Katalog (Trennwand, Lavabo, Rückwand) mit 3D-Glasdeck und technischem PDF.
Kein Build nötig: `index.html` wird direkt ausgeliefert.

## Vercel

1. Auf vercel.com „Add New → Project“ und dieses Repository wählen.
2. Framework Preset: **Other**. Build Command: leer lassen. Output Directory: `.` (Standard).
3. Deploy. Jeder Push auf `main` aktualisiert die Seite.

## Lokal ansehen

```
npx serve .
```

Das 3D-Deck lädt three.js von jsDelivr; ohne Internet oder ohne WebGL2 zeigt es die vorgerenderten Bilder `media/kombi-NN.jpg`.

## Quelle

Erzeugt aus `public/prototyp/v3/` im Repository `HigorVibeCode/B-chlerGlas` (Texturen: `scripts/glass-textures.py`, PDF: `scripts/technik-katalog.py` + `scripts/technik-pdf.mjs`).
Die Seite ist mit `noindex` markiert, bis sie öffentlich beworben werden soll.
