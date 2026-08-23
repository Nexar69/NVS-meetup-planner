# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that coordinates real public-transport journeys for groups of **2–6 people**.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.7.2 — read-only group & personal sharing

v0.7.2 makes a calculated group plan portable without adding a backend or account system.

The app now supports:

- numbered map markers **1–6** in the same order as the group roster
- a top-bar **Share group** action that creates a read-only whole-group link
- a compact **↗ Link** action under each person's trip duration in the primary recommendation
- personal links that open the same read-only plan with one person's route, countdown and timeline highlighted
- group links that keep everyone equally visible
- reconstruction of the shared group, meetup place/time, optimisation mode, ASAP/target mode and Meet-first priorities
- the existing ★ route-convergence and shared-transit display inside shared views
- a clear privacy confirmation before a shared plan is created

Shared plans remain static-app links: the plan configuration is encoded into the URL and the recipient's browser fetches fresh Transitous routes for that configuration. No shared-plan database is created.

A shared viewer hides planner/edit controls, hides the backup recommendation, keeps map/timeline viewing controls available, and provides an **Open planner** link to return to the normal editable app.

To reconstruct group routes and ★ join points, a full or personal shared-plan link contains the group names and starting locations, the meetup place/time, colours, route preference and priority selection. The share confirmation explicitly says this before the link is handed to the system share sheet or clipboard.

Opening a shared plan temporarily loads the shared state early enough for the first route calculation, then restores the recipient's previous local planner preferences after the shared recommendation is rendered. Shared-link loading is not intended to replace the recipient's own saved setup.

## v0.7.1 — group route convergence

v0.7.1 builds on the v0.7 group planner and adds a shared convergence layer so the app can explain not only **when** people arrive, but also **where group members actually join each other on the way**.

The app can now:

- keep **all group members visible on the map** for the selected recommendation
- detect meaningful intermediate joins from normalized stop/platform/time data instead of map-line intersections
- place a **★ join marker** where two or more people meet
- describe progressive joins such as `Max joins You + Alex`
- keep **M** as the final whole-group meetup marker
- detect matching onward transit legs and highlight shared travel with a dark dashed overlay
- show the same ★ join events inside each affected person’s detailed journey timeline
- replace the generic first-meet estimate in result cards with the first detected stop/time when one exists
- keep final `👥 Everyone together` events in the per-person journey detail

Join detection uses stop presence intervals built from route legs and intermediate stops. It allows a small timing tolerance for realtime uncertainty, but it does not treat two routes merely crossing on the map as a meetup.

When MOTIS exposes enough detail to identify the same onward transit trip/line, the app can also show text such as `Continue together on Tram 2` and highlight that shared section on the map. The shared overlay is derived locally from already-fetched route data and does not create extra Transitous requests.

## v0.7 — group meetup planning

v0.7 generalised the original two-person matcher into a group planner while keeping the app static, backend-free and PWA-friendly.

The app can:

- plan live journeys for **2–6 people** to one meetup point
- add/remove people and edit their names
- colour-code each person and keep those colours on the map, cards and journey timelines
- reorder the group for a clearer 1/2/3/4/5/6 display order
- choose one or more people under **Meet first**
- distinguish a priority first meetup from the time the **whole group** is together
- optimise for **🤝 Arrive together**, **⚡ Get there fastest**, or **😌 Easy trip**
- use either a chosen arrival time or **🚀 Meet ASAP**
- show a primary and backup group recommendation
- explain **Why this one?** in normal language
- show one live leave countdown and one detailed route timeline per person
- keep stop/platform letters such as `Marienplatz A → Marienplatz D` when MOTIS provides them

The first two people retain the existing search/GPS flow. Additional people use the same Schwerin place-search data and may start at stops, streets, addresses or places.

## Group matching algorithm

A naive group matcher can explode quickly: if six people each have ten candidate routes, a full Cartesian product would contain one million combinations.

v0.7 uses a bounded **beam search** instead:

1. candidate routes for each person are pre-ranked around the selected timing mode
2. at most eight useful routes per person are expanded
3. after adding each person, only the strongest partial group combinations are retained
4. the final groups are scored using the selected optimisation mode

The current beam width is intentionally conservative for phone/tablet performance.

Group metrics include:

- whole-group arrival spread
- target-time difference or ASAP time
- total and maximum individual travel time
- combined walking time
- combined transfers
- optional first-meet priority penalties

### Meet-first priority

With no starred people, the scorer coordinates the group normally.

If one person is starred, the algorithm tries to have that person arrive before the rest.

If two or more people are starred, the algorithm tries to let that priority group complete its own first meetup before non-priority people arrive. Recommendations also show both the **first meetup** and **whole group together** times.

v0.7.1 adds detected route joins on top of this scoring. The Meet-first preference still influences which journeys win; the convergence layer then explains where those selected journeys physically come together.

## Optimisation modes

### 🤝 Arrive together

Strongly minimises the spread between the earliest and latest group arrival while still considering travel time and the requested meetup time.

### ⚡ Get there fastest

Prioritises total/longest journey time while keeping the group reasonably coordinated.

### 😌 Easy trip

Penalises transfers and walking more strongly, but still avoids absurdly slow options.

### 🚀 Meet ASAP

Uses now as the practical search horizon and ranks by the earliest realistic time the whole group can be together.

## Live routing and route detail

Routing uses Transitous / MOTIS v6. The routing layer keeps, where available:

- mode and line
- departure/arrival times
- direction/headsign
- boarding/alighting platform or stop letter
- intermediate stops
- walking instructions
- realtime delay information
- route geometry

The live departure board updates countdowns locally without generating extra routing requests.

Routes that already departed on the current day are filtered from future meetup searches.

## Route convergence detection

`convergence.js` analyzes the already-selected group recommendation locally.

For every person it builds stop visits from:

- leg origins and destinations
- intermediate stops
- arrival/departure times
- platform/track metadata where available

Adjacent visits at the same stop are merged into a small presence interval. A join is considered possible only when at least two members have compatible presence intervals at the same normalized stop. A small tolerance is used for realtime uncertainty.

For display, the detector then:

- groups simultaneous members into a join event
- tracks progressive group formation (`1 + 2 meet`, then `3 joins 1 + 2` conceptually, while displayed text uses people's names)
- derives an approximate map point from the real route geometry at that event time
- checks following/active transit legs for a shared trip or matching line
- emits per-member event lists used by the journey timelines

The final destination is emitted separately as **👥 Everyone together**, while the map continues to use its normal **M** marker for that point.

## Fair Meetup beta

Fair Meetup currently remains a **two-person-only** feature. When more than two people are in the roster, its button is disabled.

This is deliberate: the beta tests three central candidate destinations, so group-wide Fair Meetup could multiply the number of routing requests quickly. The normal group planner only needs one route request per person.

The current Fair Meetup candidates are:

- Marienplatz
- Dreescher Markt
- Hauptbahnhof

## Place search and GPS

Place search uses Photon/OpenStreetMap and is restricted to the Schwerin area. Search results distinguish transit stops from streets/addresses/places and prioritise a same-name transit stop over a street when appropriate.

The app can use the device’s current location for the first person after explicit browser permission.

## Maps

Leaflet + OpenStreetMap render the recommendation. In group mode every person has their own colour and **1/2/3/4/5/6** marker, **★** marks intermediate joins, and **M** is the final meetup point.

MOTIS route geometry is used when available; dashed lines indicate approximate fallback geometry. When matching onward transit is detected, a thicker dark dashed overlay indicates members travelling together.

Personal shared links keep the whole group visible for context while visually emphasizing the intended recipient's route and related detail.

## API etiquette

Transitous is community-run, so routing work is deliberately bounded:

- normal group planner: **one request per person**
- maximum normal group size: **6 people**
- map/timeline refreshes reuse the short in-memory route cache
- group scoring and convergence detection happen locally in the browser
- convergence detection creates **no additional routing requests**
- shared plans use the same normal route requests when opened; they do not poll in the background
- Fair Meetup stays manual and two-person-only
- no background route polling
- no service-worker caching of Transitous responses

Visible Transitous/OpenStreetMap attribution is included in the app.

## Privacy choices

- no account or backend is required
- group names, colours, priority selection and added places are stored locally on the device
- GPS is requested only after the user chooses to use it
- a GPS origin is not intentionally added to persistent searched-place history
- the older lightweight meetup share flow does not automatically include starting locations
- **v0.7.2 full-group/personal plan links do include group starting locations** because those locations are required to rebuild everyone's routes and join points; the app warns before creating one
- opening a shared plan restores the viewer's previous locally saved planner preferences after the shared recommendation is loaded

## PWA / device support

The project is a static Progressive Web App designed for:

- Samsung / Android phones
- iPhone
- iPad / Android tablets
- desktop browsers

It includes an installable manifest, home-screen icons, responsive safe-area-aware layouts and an offline app shell. Live routing, search and map tiles require internet access.

## Project structure

- `index.html` — page structure and release wiring
- `styles.css` — base responsive UI
- `transit.js` — Transitous/MOTIS routing and journey normalisation
- `recommend.js` — timing and route-preference controls
- `group-engine.js` — beam-search group recommendation engine
- `group.js` / `group.css` — group roster, extra-person search, priorities and group result cards
- `group-events.js` — deterministic group submit/mobile/reset/preference event routing
- `convergence.js` / `convergence.css` — stop/time join detection, shared-transit detection and map/timeline styling
- `convergence-ui.js` — result-card and per-person journey join annotations
- `share-v072.js` / `share-v072.css` — numbered markers, share-link encoding/bootstrap, read-only viewers and personal-route highlighting
- `map.js` / `map.css` — group-aware Leaflet map and shared-route rendering
- `journey.js` / `journey.css` — live departure board and detailed per-person timelines
- `places.js` / `places.css` — Photon search, GPS, local place history and lightweight meetup sharing
- `fair.js` / `fair.css` — two-person Fair Meetup beta
- `service-worker.js` — offline app-shell cache only
- `manifest.webmanifest` — PWA metadata
- `icons/` — app/home-screen icons

## Run locally

Use a local HTTP server for service-worker and cross-origin testing, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

The public deployment uses GitHub Pages.

## Possible next milestones

- group-aware Fair Meetup with a carefully bounded request budget
- shared invitations where each friend can optionally supply/update only their own origin
- disruption/cancellation presentation
- saved named places such as Home / School
- optional leave reminders where PWA support is reliable
- accessibility/preferences for walking limits or mobility needs

## License

MIT. See `LICENSE`.