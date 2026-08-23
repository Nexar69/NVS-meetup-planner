# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that helps two people arrive at the same place at roughly the same time by public transport.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.3 — real routing + interactive maps

The app uses the public **Transitous / MOTIS v6** routing API for real timetable searches and now visualizes the matched journeys on an interactive Leaflet/OpenStreetMap map.

Core flow:

1. choose two starting stops
2. choose one meetup stop
3. choose a target arrival date/time
4. request a two-hour route window for each person
5. normalize the returned MOTIS itineraries and decode route geometry
6. compare every possible route pair locally
7. show **Early**, **Best**, and **Later** coordinated meetup suggestions
8. display either person's real route geometry on one shared map

The matching score currently prioritizes:

- closeness to the requested meetup time
- minimizing how long one person waits for the other

## Interactive map

v0.3 adds:

- both starting points and the meetup point on one map
- separate route colors for you and your friend
- real MOTIS leg geometry when Transitous supplies it
- a clearly dashed approximate connector when geometry is unavailable
- Early / Best / Later map tabs
- tap a result card to show that pair on the map
- Fit both routes control
- responsive map sizing for phones, Samsung devices, iPad/tablets, and desktop

The map uses Leaflet 1.9.4 with OpenStreetMap's standard tiles. Map tiles are not downloaded for offline use or stored by the service worker.

## Current Schwerin presets

- Lankow-Siedlung
- Hegelstraße
- Dreescher Markt
- Marienplatz
- Hauptbahnhof

The coordinates are based on current DELFI/OpenStreetMap stop positions. Free-text stop/address search is planned for a later milestone.

## Data source and API etiquette

Routing is performed by [Transitous](https://transitous.org/) using MOTIS. Transitous is community-run, so the app deliberately keeps requests small: one request per person per search, with a short in-memory cache to avoid repeated identical requests. The map reuses those cached journeys instead of intentionally adding another pair of network requests.

Transit and OpenStreetMap attribution links are visible in the app. Transitous data-source details are available at <https://transitous.org/sources/>.

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

Real journey searches and fresh map tiles require an internet connection.

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
- `live.css` — live-routing states and loading UI
- `map.css` — responsive map UI, markers, legend and map controls
- `transit.js` — Transitous client, Schwerin presets, response normalization and MOTIS polyline decoding
- `map.js` — Leaflet map controller and Early/Best/Later route visualization
- `app.js` — meetup pairing/scoring, UI state and PWA install UX
- `manifest.webmanifest` — PWA metadata
- `service-worker.js` — offline app-shell cache; third-party timetable/map requests are intentionally not cached
- `icons/` — home-screen/app icons

## Roadmap

### v0.3.x

- validate route geometry across more Schwerin connections
- improve route-detail rendering and realtime delay indicators
- tune meetup scoring with real-world cases

### v0.4

- stop/address search using an autocomplete-capable provider
- current-location starting point
- clearer stop/platform selection
- shareable meetup links

### Later

- more than two people
- missed-connection/live re-planning
- fair meeting-place discovery

## License

MIT. See `LICENSE`.
