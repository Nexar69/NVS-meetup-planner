# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that helps two people arrive at the same place at roughly the same time by public transport.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.5 — live meetup companion

v0.5 builds on the real Transitous routing, place search, GPS, sharing and interactive maps from earlier releases.

The app can now:

- plan coordinated **Early / Best / Later** journey pairs
- use real Transitous / MOTIS v6 public-transport routing
- search Schwerin stops, streets and places with Photon
- use the user's current location as their own starting point after browser permission
- draw both routes on one Leaflet / OpenStreetMap map
- show a **live departure board** for the Best pair
- update “leave in …” countdowns locally without extra API requests
- ignore same-day journeys that have already departed
- offer **Recalculate now** when a displayed departure becomes stale
- expand each result into detailed journey timelines with line/mode, stop names, direction, platform and realtime delay information when MOTIS supplies it
- run a manual **Fair Meetup beta** that compares a small set of central Schwerin hubs and ranks them by fairness
- share meetup destination/date/time without automatically sharing either person's starting location

## Fair Meetup beta

Fair Meetup is deliberately opt-in because route searches are one of the more expensive operations for the community-run Transitous service.

The current beta checks three central candidates:

- Marienplatz
- Dreescher Markt
- Hauptbahnhof

For each candidate it finds the best coordinated route pair and scores it using:

- difference between both people's travel times — strongest weight
- arrival-time gap
- distance from the requested meetup time
- maximum/total journey length, so an equally terrible pair of journeys does not win simply because it is technically fair

The dialog shows the fairest option, the fastest candidate where relevant, and a backup. Choosing **Meet here** switches the normal planner to that destination and runs the standard live search/map flow.

A Fair Meetup run makes at most six route searches (two people × three candidates), runs only after a deliberate button press, spaces candidate checks slightly, and reuses the normal two-minute route cache.

## Live departure board

For the normal **Best** meetup pair, v0.5 shows both departure times and a continuously updated local countdown such as:

- `in 18 min`
- `in 4 min`
- `leave now`
- `2 min ago`

The countdown itself never contacts Transitous. It only compares the already-selected departure time with the device clock.

For a future meetup on the current day, routes whose departure already passed are filtered out before matching. This applies to the normal planner, map refreshes, Fair Meetup, and recalculation.

## Detailed journey timelines

MOTIS `detailedLegs` and `detailedTransfers` are enabled. The routing layer normalizes each leg into a small client-side segment containing, where available:

- mode and line
- origin/destination stop names
- leg departure/arrival times
- direction/headsign
- boarding/alighting platform
- realtime delay annotation
- duration
- route geometry

The result cards expose these segments through an expandable timeline for both people.

## Current built-in Schwerin presets

- Lankow-Siedlung
- Hegelstraße
- Dreescher Markt
- Marienplatz
- Hauptbahnhof
- Schlosspark-Center

Search results can add additional Schwerin locations at runtime. Non-GPS searched places are remembered locally on the device with a capped recent-place history.

## Routing and API etiquette

Routing is performed by [Transitous](https://transitous.org/) using MOTIS. Transitous is community-run, so the app deliberately tries to keep routing work bounded:

- normal planner: one request per person
- map/timeline layers reuse the same short in-memory route cache
- Fair Meetup: manual only, three candidates maximum
- no background route polling
- no service-worker caching of Transitous responses

Visible Transitous source attribution is included in the app footer.

## Place search

Place search uses Photon/OpenStreetMap and is restricted to the Schwerin area. The client:

- debounces search-as-you-type requests
- aborts stale searches
- caps visible results
- briefly caches repeated searches on-device

## Privacy choices

- GPS is requested only after tapping **My location** and accepting browser permission.
- A GPS location is not added to the persistent searched-place history.
- Shared meetup links contain the destination coordinates/label and date/time, not either person's starting point by default.
- Transitous receives route origins/destinations/times for routing; see Transitous's published privacy information for its logging policy.

## PWA / device support

The project is a static Progressive Web App designed for:

- Samsung / Android phones
- iPhone
- iPad / Android tablets
- desktop browsers

It includes an installable manifest, home-screen icons, safe-area-aware responsive layouts, device-local preferences and an offline app shell. Real routing, place search and fresh map tiles still require internet access.

## Run locally

Use a local HTTP server for full service-worker / cross-origin testing, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The public deployment uses GitHub Pages.

## Project structure

- `index.html` — page structure and script/style wiring
- `styles.css` — base responsive UI
- `live.css` — live-routing/loading states
- `map.css` / `map.js` — Leaflet map and Early/Best/Later visualization
- `places.css` / `places.js` — Photon search, GPS, local place history and sharing
- `fair.css` / `fair.js` — Fair Meetup beta
- `journey.css` / `journey.js` — live departure board and detailed timelines
- `transit.js` — Transitous client, dynamic locations, MOTIS normalization and geometry decoding
- `v05.js` — v0.5 release glue and same-day stale-departure guard
- `app.js` — core meetup pairing/scoring and base planner UI
- `service-worker.js` — offline app-shell cache; third-party live data is intentionally excluded
- `manifest.webmanifest` — PWA metadata
- `icons/` — home-screen/app icons

## Possible next milestones

- expand Fair Meetup with more carefully selected candidates without abusing the public routing service
- 3+ person group meetup planning
- better disruption/cancellation presentation
- saved named places such as Home / School, stored locally
- optional reminders where platform PWA support is reliable
- one-tap “I missed it” replanning that can also renegotiate the meetup time

## License

MIT. See `LICENSE`.
