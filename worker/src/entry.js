import app from "./index.js";

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

    return app.fetch(request, env, ctx);
  },
};
