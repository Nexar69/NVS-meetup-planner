import app from "./index.js";
import { vmvRestPlan } from "./vmv-rest.js";

const DEFAULT_APP_URL = "https://nexar69.github.io/NVS-meetup-planner/";

async function freshAppAsset(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || !/\.(?:js|css|html|webmanifest)$/i.test(url.pathname)) return null;
  const appBase = new URL(env.APP_URL || DEFAULT_APP_URL);
  const target = new URL(url.pathname.replace(/^\/+/, ""), appBase);
  const response = await fetch(target.toString(), {
    headers: { Accept: request.headers.get("Accept") || "*/*" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The Workers.dev origin exists only to serve short-lived shared viewers and
    // backend APIs. Do not install the GitHub Pages PWA service worker here,
    // otherwise a dynamically injected shared plan could become an offline shell.
    if (url.pathname === "/service-worker.js") {
      return new Response("", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    // Shared viewers proxy the GitHub Pages app. Code/config assets must stay
    // fresh so a short link cannot keep an old UI for several minutes after a
    // deployment. Images/icons can still use the older proxy cache in index.js.
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/p/")) {
      const fresh = await freshAppAsset(request, env);
      if (fresh) return fresh;
    }

    // Prefer the VMV-specific REST service used by current community VMV clients.
    // If it is unavailable or returns no usable journeys, fall through to the
    // existing raw VMV EFA bridge in index.js. The browser still keeps Transitous
    // as the final fallback, so one upstream cannot break the planner.
    if (url.pathname === "/api/vmv/plan" && request.method === "GET") {
      const restResponse = await vmvRestPlan(request, env);
      if (restResponse.ok) return restResponse;

      const efaResponse = await app.fetch(request, env, ctx);
      if (efaResponse.ok) return efaResponse;

      let restError = null;
      let efaError = null;
      try { restError = await restResponse.clone().json(); } catch {}
      try { efaError = await efaResponse.clone().json(); } catch {}

      const headers = new Headers(efaResponse.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "no-store");
      return new Response(JSON.stringify({
        error: "vmv_unavailable",
        primary: restError,
        secondary: efaError,
      }), { status: 502, headers });
    }

    return app.fetch(request, env, ctx);
  },
};
