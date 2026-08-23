# Meet Schwerin v0.8 Cloudflare backend

This Worker is the optional free backend for two features:

1. **VMV / MV FÄHRT GUT routing bridge** — calls the VMV EFA endpoint and normalizes results into the same route shape used by the browser app. The browser automatically falls back to Transitous if the Worker/VMV route request fails.
2. **Short shared-plan links** — stores a validated meetup plan in Workers KV for 72 hours and serves short read-only group/personal URLs.

The normal GitHub Pages app remains usable without this Worker.

## Required Cloudflare resources

- Worker name: `meet-schwerin`
- KV binding name: `PLANS`
- `APP_URL`: `https://nexar69.github.io/NVS-meetup-planner/`
- `PLAN_TTL_SECONDS`: `259200` (72 hours)

`wrangler.toml` contains a placeholder KV namespace id. Replace `REPLACE_WITH_KV_NAMESPACE_ID` with the namespace created in the Cloudflare account.

## Deploy

```bash
cd worker
npm install
npx wrangler kv namespace create PLANS
# copy the returned namespace id into wrangler.toml
npm run deploy
```

After deployment, copy the Worker origin (for example `https://meet-schwerin.<account-subdomain>.workers.dev`) into `configuredBackend` in the root `config.js`.

## Endpoints

- `GET /api/health` — backend health
- `GET /api/vmv/plan?fromLat=...&fromLon=...&toLat=...&toLon=...&time=<ISO>` — normalized VMV journeys
- `POST /api/plans` — create a 72-hour short plan; write requests are accepted only from the configured app origin (and localhost during development)
- `GET /api/plans/:id` — retrieve a stored plan
- `GET /p/:id` — read-only whole-group view
- `GET /p/:id?me=3` — read-only personal view for person 3

## Safety / privacy choices

- Plans are limited to 2–6 members and validated before storage.
- Plan payload size is capped.
- KV entries expire automatically.
- Shared plans contain the names and coordinates required to rebuild the meetup; the share dialog tells the organizer this before creating a link.
- The Worker does not require user accounts.
- VMV responses are cached briefly at Cloudflare's edge to reduce repeated upstream requests.
- Transitous remains an automatic fallback so a VMV/backend outage does not break the planner.

## VMV note

The Worker uses the VMV EFA endpoint currently used by the open-source Öffi transport provider implementation. It is an undocumented third-party integration rather than a formal Meet Schwerin API contract, so the app keeps the fallback path and should stay conservative with request volume.
