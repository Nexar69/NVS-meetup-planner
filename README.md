# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that helps two people arrive at the same place at roughly the same time by public transport.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.4 — search + GPS + shareable meetups

The app uses the public **Transitous / MOTIS v6** routing API for timetable searches, Leaflet/OpenStreetMap for maps, and Photon/OpenStreetMap for lightweight place search around Schwerin.

Core flow:

1. choose a preset or search for a stop, street, address or place
2. optionally use browser GPS for **your own** starting point
3. choose a meetup place and target arrival date/time
4. request a route window for each person
5. normalize MOTIS itineraries and decode route geometry
6. compare every possible route pair locally
7. show **Early**, **Best**, and **Later** coordinated meetup suggestions
8. display both journeys on one shared map
9. optionally share the meetup destination + time with somebody else

The matching score currently prioritizes:

- closeness to the requested meetup time
- minimizing how long one person waits for the other

## v0.4 place search

The original fast presets remain available:

- Lankow-Siedlung
- Hegelstraße
- Dreescher Markt
- Marienplatz
- Hauptbahnhof

Each location field now also has **Search place**. Search is powered by the public Photon demo API with:

- a Schwerin bounding box
- Schwerin location bias
- a 420 ms typing debounce
- stale-request cancellation
- a short local result cache
- a maximum of six results per query

This keeps the prototype useful while respecting the public service's fair-use expectations. Search results selected by the user are saved locally on that device so they can be reused in the dropdowns.

## Current location

The **You start at** field has a **My location** button.

- GPS access only starts after the user presses the button.
- The browser permission prompt is respected.
- v0.4 limits GPS starts to the Schwerin area.
- The GPS location is not saved as a reusable custom place.
- Routing still sends the selected coordinates to Transitous because the routing service needs an origin to calculate the journey.

## Share meetup

The top bar now has a **Share** button.

The generated link contains:

- meetup destination coordinates + label
- meetup date
- meetup time

It intentionally does **not** automatically include either person's starting location. On supported mobile devices the app uses the native share sheet; otherwise it copies the meetup URL to the clipboard.

## Interactive map

The map includes:

- both starting points and the meetup point
- separate route colors for you and your friend
- real MOTIS leg geometry when Transitous supplies it
- a clearly dashed approximate connector when geometry is unavailable
- Early / Best / Later map tabs
- tap a result card to show that pair on the map
- Fit both routes control
- responsive sizing for phones, Samsung devices, iPad/tablets, and desktop

The map uses Leaflet 1.9.4 with OpenStreetMap's standard tiles. Map tiles are not downloaded for offline use or stored by the service worker.

## Data sources and API etiquette

Routing is performed by [Transitous](https://transitous.org/) using MOTIS. Transitous is community-run, so the app deliberately keeps route requests small: one request per person per search, with a short in-memory cache to avoid repeated identical requests. The map reuses cached journeys.

Place search uses [Photon](https://photon.komoot.io/), which is designed for search-as-you-type and permits reasonable project use of its public server. The app debounces and caches search requests and restricts them to Schwerin.

Transitous, Photon and OpenStreetMap attribution links are visible in the app. Transitous data-source details are available at <https://transitous.org/sources/>.

If live routing fails because the device is offline, the API is unavailable, or a browser blocks the request, the app switches to an **explicitly labelled demo fallback**. Demo results are never presented as real journeys.

## PWA / device support

The project is a static Progressive Web App designed for:

- Samsung / Android phones
- iPhone
- iPad / Android tablets
- desktop browsers

It includes responsive layouts, an installable manifest, app icons, iOS home-screen metadata, offline app-shell caching, device-local planner preferences, and online/offline status.

Real journey searches, place searches and fresh map tiles require an internet connection.

## Run locally

Because service workers, geolocation and cross-origin API requests work best from a proper HTTP/HTTPS origin, don't just double-click `index.html` for full PWA testing.

For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The public deployment uses GitHub Pages over HTTPS, which is also required for browser geolocation on mobile.

## Project structure

- `index.html` — page structure and accessibility markup
- `styles.css` — main responsive UI
- `live.css` — live-routing states and loading UI
- `map.css` — responsive map UI, markers, legend and controls
- `places.css` — v0.4 search/GPS/share controls and place dialog
- `transit.js` — Transitous client, runtime locations, response normalization and MOTIS polyline decoding
- `places.js` — Photon search, GPS selection, saved custom places and share links
- `map.js` — Leaflet map controller and Early/Best/Later visualization
- `app.js` — meetup pairing/scoring, UI state and PWA install UX
- `manifest.webmanifest` — PWA metadata
- `service-worker.js` — offline app-shell cache; third-party routing/search/map requests are intentionally not cached
- `icons/` — home-screen/app icons

## Roadmap

### v0.4.x

- validate Photon searches across more Schwerin addresses/stops
- improve stop/platform labeling
- improve realtime delay indicators
- tune meetup scoring with real-world cases

### v0.5 ideas

- more than two people
- a proper shared meetup flow where each participant chooses their own start
- live departure countdowns
- missed-connection re-planning
- fair meeting-place discovery

## License

MIT. See `LICENSE`.
