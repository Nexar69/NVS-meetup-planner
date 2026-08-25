(() => {
  const EXPECTED_RELEASE = "v0.11.1";
  const REQUIRED_CAPABILITIES = ["sharedCheckins", "organizerReplan", "capabilityRevocation", "realtimeDisruptions", "authoritativeExpiry"];
  const CHECK_INTERVAL = 5 * 60 * 1000;
  let state = { status: "unknown", checkedAt: 0, detail: "Not checked yet", health: null };
  let timer = null;
  let checking = false;

  function backendBase() {
    return String(window.NVSConfig?.backendUrl || "").replace(/\/$/, "");
  }

  function providerState() {
    const current = window.NVSTransit?.getProviderStatus?.() || {};
    return {
      provider: String(current.provider || "Routing"),
      fallback: Boolean(current.fallback),
    };
  }

  function classify(health) {
    if (!health || health.ok !== true) return { status: "error", detail: "Backend health response is invalid." };
    const missing = REQUIRED_CAPABILITIES.filter((key) => health.capabilities?.[key] !== true);
    if (health.release !== EXPECTED_RELEASE || missing.length) {
      const parts = [];
      if (health.release !== EXPECTED_RELEASE) parts.push(`backend ${health.release || "unknown"}, app ${EXPECTED_RELEASE}`);
      if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
      return { status: "warn", detail: `Backend capability mismatch (${parts.join("; ")}).` };
    }
    return { status: "good", detail: "Backend and app capabilities match, including shared-session lifecycle support." };
  }

  function formatAge(timestamp) {
    if (!timestamp) return "not checked";
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)} min ago`;
  }

  function ensurePanel() {
    let panel = document.getElementById("v0111ProviderHealth");
    if (panel) return panel;
    const diagnostics = document.getElementById("v011Diagnostics");
    const command = document.getElementById("v011CommandCenter");
    if (!diagnostics && !command) return null;
    panel = document.createElement("details");
    panel.id = "v0111ProviderHealth";
    panel.className = "v0111-provider-health";
    panel.innerHTML = `<summary><span class="v0111-health-dot" aria-hidden="true">●</span><strong>System status</strong><small id="v0111HealthSummary">Checking…</small></summary><div class="v0111-health-body" id="v0111HealthBody" role="status" aria-live="polite"></div>`;
    if (diagnostics) diagnostics.insertAdjacentElement("afterend", panel);
    else command.appendChild(panel);
    return panel;
  }

  function render() {
    const panel = ensurePanel();
    if (!panel) return;
    const provider = providerState();
    panel.dataset.health = state.status;
    const summary = panel.querySelector("#v0111HealthSummary");
    const body = panel.querySelector("#v0111HealthBody");
    if (summary) {
      summary.textContent = state.status === "good"
        ? "Backend matched"
        : state.status === "warn"
          ? "Check backend"
          : state.status === "offline"
            ? "Offline"
            : state.status === "error"
              ? "Backend unavailable"
              : "Checking…";
    }
    if (body) {
      const routing = provider.fallback ? `${provider.provider} fallback active` : `${provider.provider} active`;
      const release = state.health?.release ? `Worker ${state.health.release}` : "Worker version unavailable";
      body.innerHTML = `<p><strong>${routing}</strong></p><p>${state.detail}</p><p class="v0111-health-meta">${release} · checked ${formatAge(state.checkedAt)} · no location data is sent by this check.</p>`;
    }
  }

  async function check() {
    if (checking) return;
    const base = backendBase();
    if (!base) {
      state = { status: "warn", checkedAt: Date.now(), detail: "No backend URL is configured.", health: null };
      render();
      return;
    }
    if (!navigator.onLine) {
      state = { ...state, status: "offline", checkedAt: Date.now(), detail: "Offline — cached app features remain available, but backend health cannot be checked." };
      render();
      return;
    }
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${base}/api/health`, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const health = await response.json();
      const result = classify(health);
      state = { ...result, checkedAt: Date.now(), health };
    } catch (error) {
      state = {
        status: navigator.onLine ? "error" : "offline",
        checkedAt: Date.now(),
        detail: navigator.onLine ? "Could not reach the routing/share backend." : "Offline — backend health check skipped.",
        health: null,
      };
    } finally {
      clearTimeout(timeout);
      checking = false;
      render();
      schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(check, CHECK_INTERVAL);
  }

  function start() {
    render();
    void check();
    schedule();
  }

  ["online", "offline", "nvs-routing-provider"].forEach((name) => window.addEventListener(name, () => {
    render();
    if (name !== "nvs-routing-provider") void check();
  }));
  window.addEventListener("nvs-group-recommendations-rendered", render);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else if (Date.now() - state.checkedAt > CHECK_INTERVAL) void check();
    else schedule();
  });
  window.addEventListener("pageshow", start);

  window.NVSProviderHealth0111 = Object.freeze({
    check,
    getState: () => ({ ...state, health: state.health ? { ...state.health } : null }),
  });

  start();
})();
