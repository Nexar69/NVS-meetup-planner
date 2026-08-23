# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that helps two people arrive at the same place at roughly the same time by public transport.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.2 — real routing

The app now uses the public **Transitous / MOTIS v6** routing API for real timetable searches.

Core flow:

1. choose two starting stops
2. choose one meetup stop
3. choose a target arrival date/time
4. request a two-hour route window for each person
5. normalize the returned MOTIS itineraries
6. compare every possible route pair locally
7. show **Early**, **Best**, and **Later** coordinated meetup suggestions

The matching score currently prioritizes:

- closeness to the requested meetup time
- minimizing how long one person waits for the other

## Current Schwerin presets

- Lankow-Siedlung
- Hegelstraße
- Dreescher Markt
- Marienplatz
- Hauptbahnhof

The coordinates are based on current DELFI/OpenStreetMap stop positions. Free-text stop/address search is planned for a later milestone.

## Data source and API etiquette

Routing is performed by [Transitous](https://transitous.org/) using MOTIS. Transitous is community-run, so the app deliberately keeps requests small: one request per person per search, with a short in-memory cache to avoid repeated identical requests.

Transit and OpenStreetMap attribution links are visible in the app footer. Transitous data-source details are available at <https://transitous.org/sources/>.

If live routing fails because the device is offline, the API is unavailable, or a browser blocks the request, the app switches to an **explicitly labelled demo fallback**. Demo results are never presented as real journeys.

## PWA / device support

The project is a static Progressive Web App and is designed for:

- Samsung / Android phones
- iPhone
- iPad / Android tablets
- desktop browsers

It includes:

- responsive phone/tablet/desktop layouts
- installable web-app manifest
- app icons
- iOS home-screen metadata
- offline caching for the app shell
- device-local planner preferences
- online/offline status

Real journey searches still require an internet connection.

## Run locally

Because service workers and cross-origin API requests work best from an HTTP origin, don't just double-click `index.html` for full PWA testing.

For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The public deployment uses GitHub Pages.

## Project structure

- `index.html` — page structure and accessibility markup
- `styles.css` — main responsive UI
- `live.css` — v0.2 live-routing states and loading UI
- `transit.js` — Transitous client, Schwerin presets and response normalization
- `app.js` — meetup pairing/scoring, UI state and PWA install UX
- `manifest.webmanifest` — PWA metadata
- `service-worker.js` — offline app-shell cache (third-party timetable requests are intentionally not cached)
- `icons/` — home-screen/app icons

## Roadmap

### v0.2.x

- validate live routes across more Schwerin stop combinations
- improve route-detail rendering and realtime delay indicators
- tune the meetup score using real-world cases

### v0.3

- stop/address autocomplete instead of fixed presets
- current-location starting point
- clearer stop/platform selection

### Later

- shareable meetup links
- more than two people
- map view
- missed-connection/live re-planning
- fair meeting-place discovery

## License

MIT. See `LICENSE`.
