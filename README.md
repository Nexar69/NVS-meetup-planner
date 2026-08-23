# NVS Meetup Planner

A small, unofficial Schwerin-focused meetup planner that helps two people arrive at the same place at roughly the same time.

> **Status:** early idea-project prototype. It is not affiliated with Nahverkehr Schwerin (NVS).

## Current version: v0.1.1 PWA

The prototype currently uses generated/demo timetable data. The important part that already works is the meetup-matching concept:

- choose two starting points
- choose one meetup destination
- choose a target arrival date/time
- compare all possible route pairs
- show three coordinated suggestions: **Early**, **Best**, and **Later**
- penalize route pairs that make one person wait much longer than the other

### Mobile / tablet support

The interface is mobile-first and responsive for Android phones, Samsung Internet/Chrome, iPad, desktop and other modern browsers.

v0.1.1 adds:

- installable Progressive Web App (PWA) metadata
- Android/Samsung home-screen installation support where the browser exposes it
- iPad/iPhone Add to Home Screen guidance
- safe-area handling for modern phones/tablets
- sticky mobile action button
- 16px form controls to avoid unwanted iOS/iPadOS input zoom
- offline app-shell caching
- remembered planner choices using local storage
- quick target-time buttons
- swap-starting-points action
- online/offline status

## Run locally

Opening `index.html` directly is enough for the basic demo UI, but PWA features such as the service worker require HTTP/HTTPS.

For local PWA testing, run a simple static server in this folder, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

This repository is designed to work as a static GitHub Pages site from the repository root.

In GitHub:

1. **Settings**
2. **Pages**
3. Under **Build and deployment**, choose **Deploy from a branch**
4. Select `main`
5. Select `/ (root)`
6. Save

When Pages finishes deploying, the same HTTPS site can be opened on Samsung, iPad, PC, or shared with a friend.

## Project structure

- `index.html` — semantic app/page structure
- `styles.css` — responsive phone/tablet/desktop design
- `app.js` — demo route source, pairing algorithm, UI state and PWA install handling
- `manifest.webmanifest` — installable web-app metadata
- `service-worker.js` — lightweight offline app-shell cache
- `icons/` — PWA/home-screen icons

## Roadmap

### v0.2 — real Schwerin journeys
Replace the `generateDemoRoutes()` boundary with real public-transport routing results while keeping the pairing/scoring engine.

### v0.3 — location search
Use real stops/places and autocomplete instead of the small demo dropdowns.

### v0.4 — sharing and live features
Possible ideas: shareable meetup links, current location, delay-aware recalculation, groups, and fair-meeting-point discovery.
