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

  function hasValidExpiry(value) {
    if (value == null || value === "") return false;
    if (typeof value === "number") return Number.isFinite(value) && value > 0;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) && parsed > 0;
  }

  function sharedSummary() {
    const state = window.NVSSharedLive?.getState?.() || null;
    if (!state) return { available: false };
    const members = state.members && typeof state.members === "object" ? Object.values(state.members) : [];
    return {
      available: true,
      revision: Number(state.revision) || null,
      hasAuthoritativeExpiry: hasValidExpiry(state.expiresAt),
      hasLiveUpdates: members.length > 0,
      liveUpdateCount: members.length,
    };
  }

  function sharedConnectionSummary(now = Date.now()) {
    const api = window.NVSSharedConnection0111;
    if (!api?.connectionModel || !api?.getLastSuccessAt) return { available: false };
    let successAt = 0;
    try { successAt = Number(api.getLastSuccessAt()) || 0; } catch {}
    let model = null;
    try { model = api.connectionModel(now, navigator.onLine, successAt); } catch {}
    const ageMs = successAt > 0 ? Math.max(0, Number(now) - successAt) : null;
    return {
      available: true,
      status: String(model?.status || "unknown"),
      hasSuccessfulResponse: successAt > 0,
      lastResponseAgeSeconds: ageMs == null ? null : Math.floor(ageMs / 1000),
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

  function offlineSummary(now = Date.now()) {
    const api = window.NVSOfflineJourney0111;
    if (!api?.readSnapshot) return { available: false, saved: false };
    let snapshot = null;
    try { snapshot = api.readSnapshot(now); } catch {}
    if (!snapshot) return { available: true, saved: false };
    let ageMs = null;
    try {
      const value = Number(api.snapshotAgeMs?.(snapshot, now));
      if (Number.isFinite(value) && value >= 0) ageMs = value;
    } catch {}
    let realtimeFresh = null;
    try {
      if (typeof api.realtimeContextFresh === "function") realtimeFresh = Boolean(api.realtimeContextFresh(snapshot, now));
    } catch {}
    return {
      available: true,
      saved: true,
      segmentCount: Array.isArray(snapshot.segments) ? snapshot.segments.length : 0,
      ageMinutes: ageMs == null ? null : Math.floor(ageMs / 60_000),
      realtimeContextFresh: realtimeFresh,
      hasAuthoritativeExpiry: hasValidExpiry(snapshot.expiresAt),
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
      sharedConnection: sharedConnectionSummary(now.getTime()),
      provider: providerSummary(),
      pwa: pwaSummary(),
      offlineJourney: offlineSummary(now.getTime()),
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
    panel.innerHTML = `<summary><strong>Debug snapshot</strong><small>Privacy-safe diagnostics</small></summary><div><p>Copy release, routing, shared-sync, offline-fallback and PWA state for bug reports. Names, coordinates, capability keys and plan IDs are excluded.</p><button type="button" id="v0111CopyDiagnostics">Copy diagnostics</button><small id="v0111DiagnosticsStatus" role="status" aria-live="polite"></small></div>`;
    if (health) health.insertAdjacentElement("afterend", panel);
    else command.appendChild(panel);
    panel.querySelector("#v0111CopyDiagnostics")?.addEventListener("click", copyDiagnostics);
    return panel;
  }

  function fallbackClipboardCopy(text) {
    if (!document.createElement || !document.body?.appendChild || typeof document.execCommand !== "function") return false;
    let textarea = null;
    try {
      textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute?.("readonly", "");
      textarea.setAttribute?.("aria-hidden", "true");
      if (textarea.style) {
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        textarea.style.opacity = "0";
      }
      document.body.appendChild(textarea);
      textarea.select?.();
      textarea.setSelectionRange?.(0, text.length);
      return document.execCommand("copy") === true;
    } catch {
      return false;
    } finally {
      try { textarea?.remove?.(); } catch {}
    }
  }

  async function copyDiagnostics() {
    const panel = ensurePanel();
    const status = panel?.querySelector("#v0111DiagnosticsStatus");
    const text = JSON.stringify(buildSnapshot(new Date()), null, 2);
    let copied = false;
    try {
      if (typeof navigator.clipboard?.writeText === "function") {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      // iOS/Safari can reject the modern Clipboard API even after an explicit tap.
      // Fall through to a short-lived textarea copy without persisting diagnostics.
    }
    if (!copied) copied = fallbackClipboardCopy(text);
    if (status) {
      status.textContent = copied
        ? "Copied. Safe to paste into a bug report."
        : "Clipboard access was unavailable. Keep this tab active and try again.";
    }
    return copied;
  }

  function refresh() { ensurePanel(); }
  ["load", "pageshow", "nvs-group-recommendations-rendered", "nvs-routing-provider", "nvs-shared-live-change"].forEach((name) => window.addEventListener(name, refresh));
  window.NVSDiagnostics0111 = Object.freeze({ buildSnapshot, sharedConnectionSummary, offlineSummary, fallbackClipboardCopy, copyDiagnostics, refresh });
  refresh();
})();