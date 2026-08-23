# NVS Meetup Planner / Meet Schwerin

An unofficial, mobile-first Schwerin meetup planner that coordinates real public-transport journeys for groups of **2–6 people**.

> This project is not affiliated with Nahverkehr Schwerin (NVS).

## v0.7 — group meetup planning

v0.7 generalises the original two-person matcher into a group planner while keeping the app static, backend-free and PWA-friendly.

The app can now:

- plan live journeys for **2–6 people** to one meetup point
- add/remove people and edit their names
- colour-code each person and keep those colours on the map, cards and journey timelines
- reorder the group for a clearer A/B/C/D/E/F display order
- choose one or more people under **Meet first**
- distinguish a priority first meetup from the time the **whole group** is together
- optimise for **🤝 Arrive together**, **⚡ Get there fastest**, or **😌 Easy trip**
- use either a chosen arrival time or **🚀 Meet ASAP**
- show a primary and backup group recommendation
- explain **Why this one?** in normal language
- show one live leave countdown and one detailed route timeline per person
- draw every person’s route toward the same meetup point on one Leaflet/OpenStreetMap map
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

Leaflet + OpenStreetMap render the recommendation. In group mode every person has their own colour and A/B/C/D/E/F marker, while **M** is the meetup point.

MOTIS route geometry is used when available; dashed lines indicate approximate fallback geometry.

## API etiquette

Transitous is community-run, so routing work is deliberately bounded:

- normal group planner: **one request per person**
- maximum normal group size: **6 people**
- map/timeline refreshes reuse the short in-memory route cache
- group scoring happens locally in the browser
- Fair Meetup stays manual and two-person-only
- no background route polling
- no service-worker caching of Transitous responses

Visible Transitous/OpenStreetMap attribution is included in the app.

## Privacy choices

- no account or backend is required
- group names, colours, priority selection and added places are stored locally on the device
- GPS is requested only after the user chooses to use it
- a GPS origin is not intentionally added to persistent searched-place history
- shared meetup links do not automatically include every person’s starting location

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
- `group-engine.js` — v0.7 beam-search group recommendation engine
- `group.js` / `group.css` — group roster, extra-person search, priorities and group result cards
- `group-events.js` — deterministic group submit/mobile/reset/preference event routing
- `map.js` / `map.css` — group-aware Leaflet map
- `journey.js` / `journey.css` — live departure board and detailed per-person timelines
- `places.js` / `places.css` — Photon search, GPS, local place history and sharing
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
- shared group invitations where each friend fills their own origin locally
- disruption/cancellation presentation
- saved named places such as Home / School
- optional leave reminders where PWA support is reliable
- accessibility/preferences for walking limits or mobility needs

## License

MIT. See `LICENSE`.