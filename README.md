# NVS Meetup Planner

A small Schwerin-focused meetup planner that helps two people arrive at the same place at roughly the same time using public transport.

## v0.1

This first prototype uses demo timetable data and focuses on the core idea:

- choose two starting points
- choose one meetup destination
- choose a target arrival date/time
- compare all possible route pairs
- show three coordinated suggestions: **Early**, **Best**, and **Later**

The next milestone is replacing the demo route generator with real Schwerin public-transport journey data.

## Run locally

Open `index.html` in a browser. No build step or dependencies are required.

## Project structure

- `index.html` — page structure
- `styles.css` — responsive UI
- `app.js` — demo routes and meetup matching algorithm
