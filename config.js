(() => {
  const injectedBackend = String(window.__NVS_BACKEND_URL__ || "").replace(/\/+$/, "");
  const configuredBackend = "https://meet-schwerin.timothy-ua-pa.workers.dev";
  const backendUrl = injectedBackend || configuredBackend;

  window.NVSConfig = Object.freeze({
    appUrl: "https://nexar69.github.io/NVS-meetup-planner/",
    backendUrl,
    preferVmv: true,
    shareTtlSeconds: 72 * 60 * 60,
    hasBackend: Boolean(backendUrl),
  });
})();
