import app from "./index.js";
import { vmvRestPlan } from "./vmv-rest.js";

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
