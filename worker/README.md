# Meet Schwerin Cloudflare backend

This directory contains the optional Cloudflare Worker used by the Meet Schwerin web/PWA. The supported Worker project name is **`meet-schwerin`** and the deployable project root is this `worker/` directory.

The normal GitHub Pages app can still load without the Worker, but the Worker provides the preferred VMV routing bridge and the short-link/shared-live coordination APIs.

## Current responsibilities

1. **VMV / MV FÄHRT GUT routing bridge** — normalizes VMV journeys into the same route shape used by the browser. If VMV/the Worker is unavailable, the browser can fall back to Transitous.
2. **Short shared-plan links** — stores validated meetup plans in Workers KV with a bounded TTL.
3. **Voluntary shared-live status** — capability-protected personal check-ins such as left/on vehicle/at stop/missed/arrived. No background GPS is collected.
4. **Organizer replans** — the organizer can update an existing shared plan while viewers stay on the same link.
5. **Capability revocation** — the organizer can rotate one person's private check-in capability or all private capabilities without deleting visible check-in history.
6. **Authoritative session lifecycle** — new shared sessions use one absolute expiry deadline across the plan, owner capability, personal capabilities, live state and metadata. Replans/check-ins do not silently extend that deadline.
7. **Deployment diagnostics** — `/api/health` reports the Worker release and supported capabilities, including whether authoritative expiry metadata is available.

## Required Cloudflare resources

The repository contract is defined by `wrangler.toml`:

- Worker name: `meet-schwerin`
- Entry point: `src/lifecycle-entry.js`
- Core request handler: `src/entry.js`
- KV binding name: `PLANS`
- `APP_URL`: `https://nexar69.github.io/NVS-meetup-planner/`
- `PLAN_TTL_SECONDS`: `259200` (72 hours)

`lifecycle-entry.js` is a thin gateway around the existing Worker core. It preserves the established routing/shared-live behavior while making new session expiry non-sliding and exposing an authoritative `expiresAt` timestamp to clients. Legacy sessions without stored expiry metadata remain compatible and are not assigned a fabricated exact deadline.

The KV namespace ID in `wrangler.toml` is the namespace currently configured for this project. Do not replace it with a new namespace unless the deployment is intentionally being migrated.

## Local/manual deployment

```bash
cd worker
npm install
npm run deploy
```

For a new Cloudflare account/project, create or select a KV namespace first and update the `PLANS` binding deliberately. Do not create a second namespace during routine deploys.

## Cloudflare Git integration

If using Cloudflare's Git integration, configure the Worker project to build from **`worker/`**, not the repository root. The repository-supported project is named **`meet-schwerin`**.

A separate Cloudflare project connected to the same repository (for example one named after the repository itself) is a different deployment target and may fail independently if its root directory, build command, bindings, or project settings differ. Do not change application code merely to satisfy an unintended duplicate deployment; first align that project's Cloudflare settings with this contract or disconnect the duplicate project.

After deployment, the browser backend target in root `config.js` should point at the intended `meet-schwerin.<account-subdomain>.workers.dev` origin (or an injected equivalent).

## Main endpoints

- `GET /api/health` — backend release/capability diagnostics
- `GET /api/vmv/plan?...` — normalized VMV journeys
- `POST /api/plans` — create a short shared plan; writes are origin-restricted; new sessions return `expiresAt`
- `GET /api/plans/:id` — retrieve a stored plan
- `GET /p/:id` — whole-group shared view
- `GET /p/:id?me=3` — personal view for person 3
- `GET|POST /api/live/:id` — shared-live state/read or capability-protected personal check-in; authoritative sessions include `expiresAt`
- `POST /api/live/:id/plan` — organizer-authorized replan for an existing shared link without extending its expiry
- `POST /api/live/:id/capabilities` — organizer-authorized private capability rotation without extending its expiry

## Safety and privacy choices

- Plans are limited to 2–6 members and validated before storage.
- Request payload sizes are capped.
- New stored sessions expire on one non-sliding absolute deadline; active check-ins or replans do not keep them alive indefinitely.
- Shared plans contain the names and coordinates needed to rebuild the meetup; the share UI warns the organizer before creating a link.
- Personal write capabilities are separate from public plan IDs and can be revoked.
- Opened personal capability URLs are sanitized by the client and kept only in tab-scoped session storage.
- The PWA service worker deliberately does not cache `/api/` responses containing shared-live state or capabilities.
- The Worker does not require user accounts and does not implement hidden/background GPS tracking.
- VMV responses are cached only briefly to reduce upstream load, with Transitous retained as a fallback path.

## VMV note

The VMV integration uses provider endpoints that are not a formal Meet Schwerin API contract. Keep request volume conservative and preserve the fallback path when modifying routing behavior.
