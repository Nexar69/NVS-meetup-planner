(() => {
  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function viewMode() {
    const shared = window.NVSShare?.getSharedPlan?.();
    if (!shared) return "planner";
    return focusIndex() >= 0 ? "personal-shared" : "group-shared";
  }

  function routeSummary() {
    const assignments = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    if (!Array.isArray(assignments)) return { assignmentCount: 0, focusedSegmentCount: 0 };
    const focus = focusIndex();
    const selected = focus >= 0 ? assignments[focus] : assignments[0];
    return {
      assignmentCount: assignments.length,
      focusedSegmentCount: Array.isArray(selected?.route?.segments) ? selected.route.segments.length : 0,
    };
  }

  function sharedSummary() {
    const state = window.NVSSharedLive?.getState?.() || null;
    if (!state) return { available: false };
    const members = state.members && typeof state.members === "object" ? Object.values(state.members) : [];
    return {
      available: true,
      revision: Number(state.revision) || null,
      hasAuthoritativeExpiry: Number.isFinite(Number(state.expiresAt)),
      hasLiveUpdates: members.length > 0,
      liveUpdateCount: members.length,
    };
  }

  function providerSummary() {
    const routing = window.NVSTransit?.getProviderStatus?.() || {};
    const healthState = window.NVSProviderHealth0111?.getState?.() || {};
    const capabilities = healthState.health?.capabilities || {};
    return {
      routingProvider: String(routing.provider || "unknown"),
      fallback: Boolean(routing.fallback),
      backendStatus: String(healthState.status || "unknown"),
      backendRelease: healthState.health?.release ? String(healthState.health.release) : null,
      capabilities: {
        sharedCheckins: capabilities.sharedCheckins === true,
        organizerReplan: capabilities.organizerReplan === true,
        capabilityRevocation: capabilities.capabilityRevocation === true,
        realtimeDisruptions: capabilities.realtimeDisruptions === true,
        authoritativeExpiry: capabilities.authoritativeExpiry === true,
      },
    };
  }

  function pwaSummary() {
    let standalone = false;
    try { standalone = Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone); } catch {}
    return {
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      standalone,
    };
  }

  function buildSnapshot(now = new Date()) {
    const versionLabel = String(document.getElementById("versionLabel")?.textContent || "unknown").trim();
    return {
      schema: "meet-schwerin-diagnostics-v1",
      capturedAt: now.toISOString(),
      release: versionLabel,
      releaseMarker: String(document.documentElement?.dataset?.nvsRelease || ""),
      online: Boolean(navigator.onLine),
      view: viewMode(),
      route: routeSummary(),
      shared: sharedSummary(),
      provider: providerSummary(),
      pwa: pwaSummary(),
      privacy: "No names, coordinates, route geometry, capability keys, plan IDs, or location readings are included.",
    };
  }

  function ensurePanel() {
    let panel = document.getElementById("v0111DiagnosticsExport");
    if (panel) return panel;
    const health = document.getElementById("v0111ProviderHealth");
    const command = document.getElementById("v011CommandCenter");
    if (!health && !command) return null;
    panel = document.createElement("details");
    panel.id = "v0111DiagnosticsExport";
    panel.className = "v0111-diagnostics-export";
    panel.innerHTML = `<summary><strong>Debug snapshot</strong><small>Privacy-safe diagnostics</small></summary><div><p>Copy release, routing, sync and PWA state for bug reports. Names, coordinates, capability keys and plan IDs are excluded.</p><button type="button" id="v0111CopyDiagnostics">Copy diagnostics</button><small id="v0111DiagnosticsStatus" role="status" aria-live="polite"></small></div>`;
    if (health) health.insertAdjacentElement("afterend", panel);
    else command.appendChild(panel);
    panel.querySelector("#v0111CopyDiagnostics")?.addEventListener("click", copyDiagnostics);
    return panel;
  }

  async function copyDiagnostics() {
    const panel = ensurePanel();
    const status = panel?.querySelector("#v0111DiagnosticsStatus");
    const text = JSON.stringify(buildSnapshot(new Date()), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      if (status) status.textContent = "Copied. Safe to paste into a bug report.";
      return true;
    } catch {
      if (status) status.textContent = "Clipboard access was unavailable. Try again from an active tab.";
      return false;
    }
  }

  function refresh() { ensurePanel(); }
  ["load", "pageshow", "nvs-group-recommendations-rendered", "nvs-routing-provider", "nvs-shared-live-change"].forEach((name) => window.addEventListener(name, refresh));
  window.NVSDiagnostics0111 = Object.freeze({ buildSnapshot, copyDiagnostics, refresh });
  refresh();
})();
