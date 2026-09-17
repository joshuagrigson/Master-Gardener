# Master Gardener

An installable web app for mapping raised garden beds on your own photos.

- **Photo-mapped beds.** Drop in or take a photo of a bed, drag a four-corner grid onto it (perspective-corrected), and tap cells to tag what is planted there.
- **Timeline that keeps up.** Every planting carries its plant date and days-to-maturity, so the overlay shows *day N*, the growth stage, when fruit set should start, and when the first harvest is due. New photos inherit the tags; older photos show the bed as it was on their date.
- **Check-ins.** Rate each planting 1–5 with flags (watered, pests, flowering, fruit set…) and notes. Health trends show as sparklines.
- **Live analytics.** Harvest timeline, needs-attention list, and Open-Meteo weather for your location: current conditions, 7-day forecast, 7-day rain vs. evapotranspiration (water advice), heat and frost flags, and growing degree days per planting.
- **Offline PWA.** Add to Home Screen on iPhone or Android. Data lives in the browser's IndexedDB; export/import a JSON backup from Settings.

## Stack

Vanilla HTML/CSS/JS, no build step. `index.html` + `styles.css` + `app.js` (UI and state) + `db.js` (IndexedDB) + `crops.js` (crop catalog, DTM defaults, tips) + `weather.js` (Open-Meteo) + `sw.js` (offline shell).

## Grid convention

Row 1 is the **north** edge of the bed, column 1 is the **west** edge. When aligning, drag the handle labelled NW onto the bed's north-west corner, and so on. Cell indexes are `row * cols + col`.

## Deploy

Static site; the repo root is the publish directory (`netlify.toml`). Any static host works.

## Local dev

```
npx http-server -p 8080 -c-1 .
```

Then open http://127.0.0.1:8080/. The service worker only registers over https, so local runs always hit the network.
