(() => {
  const injectedBackend = String(window.__NVS_BACKEND_URL__ || "").replace(/\/+$/, "");
  const configuredBackend = ""; // Filled after the Cloudflare Worker is deployed.
  const backendUrl = injectedBackend || configuredBackend;

  window.NVSConfig = Object.freeze({
    appUrl: "https://nexar69.github.io/NVS-meetup-planner/",
    backendUrl,
    preferVmv: true,
    shareTtlSeconds: 72 * 60 * 60,
    hasBackend: Boolean(backendUrl),
  });
})();
