(() => {
  const STALE_MS = 15 * 60_000;
  const UPDATE_MS = 15_000;
  const MAX_FUTURE_SKEW_MS = 5 * 60_000;
  const ROUTE_INTELLIGENCE_IDS = [
    "v0111TripGuidance",
    "v0111StopAwareness",
    "v0111TransferWatch",
    "v0111MeetupRadar",
    "v0111WhatIf",
  ];
  let timer = null;
  let trustObserver = null;

  function freshnessFor(entry, now = Date.now()) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const at = Number(entry?.at);
    if (Number.isFinite(at) && at > timestamp + MAX_FUTURE_SKEW_MS) {
      return { fresh: false, stale: true, future: true, ageMs: 0, ageMinutes: 0 };
    }
    const core = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(timestamp));
    if (core && typeof core.fresh === "boolean") return core;
    if (!Number.isFinite(at)) return { fresh: false, stale: true, ageMs: Infinity, ageMinutes: Infinity };
    const ageMs = Math.max(0, timestamp - at);
    return { fresh: ageMs <= STALE_MS, stale: ageMs > STALE_MS, ageMs, ageMinutes: ageMs / 60_000 };
  }

  function assignments() {
    const list = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    return Array.isArray(list) ? list : [];
  }

  function timetableState(index) {
    const assignment = assignments()[index];
    if (!assignment) return null;
    return window.NVSLiveMeetup?.routeState?.(assignment, new Date()) || null;
  }

  function hasPendingPlanUpdate() {
    return Boolean(window.NVSSharedLive?.hasPendingPlanUpdate?.());
  }

  function applyPlanTrustBoundary() {
    const pending = hasPendingPlanUpdate();
    const root = document.documentElement;
    if (root?.dataset) {
      if (pending) root.dataset.nvsPlanUpdatePending = "true";
      else delete root.dataset.nvsPlanUpdatePending;
    }

    let changed = 0;
    ROUTE_INTELLIGENCE_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (!element) return;
      if (pending) {
        if (element.dataset?.nvsPlanTrustHidden !== "true" || !element.hidden) changed += 1;
        element.hidden = true;
        if (element.dataset) element.dataset.nvsPlanTrustHidden = "true";
        element.setAttribute?.("aria-hidden", "true");
        return;
      }
      if (element.dataset?.nvsPlanTrustHidden === "true") {
        element.hidden = false;
        delete element.dataset.nvsPlanTrustHidden;
        element.removeAttribute?.("aria-hidden");
        changed += 1;
      }
    });
    return changed;
  }

  function syncTrustObserver() {
    if (!("MutationObserver" in window) || !document.body) return;
    if (!trustObserver) {
      trustObserver = new MutationObserver(() => {
        if (hasPendingPlanUpdate()) applyPlanTrustBoundary();
      });
    }
    trustObserver.disconnect();
    if (hasPendingPlanUpdate()) trustObserver.observe(document.body, { childList: true, subtree: true });
  }

  function markStaleRow(row, index, entry, now = Date.now()) {
    if (!row || !entry) return false;
    const freshness = freshnessFor(entry, now);
    if (!freshness.stale) return false;

    const estimate = timetableState(index);
    const headline = estimate?.label || "Timetable only";
    const estimateDetail = estimate?.detail || "No current timetable estimate";
    const age = Number.isFinite(freshness.ageMinutes)
      ? Math.max(15, Math.round(freshness.ageMinutes))
      : 15;

    row.classList?.remove?.("manual", "live", "wait", "warn", "good");
    row.classList?.add?.("estimated", "stale-confirmation");
    if (row.dataset) row.dataset.v0111Freshness = freshness.future ? "invalid-future" : "stale";

    const label = row.querySelector?.("small");
    const detail = row.querySelector?.("em");
    const source = row.querySelector?.(".v010-source");
    if (label) label.textContent = headline;
    if (detail) {
      detail.textContent = freshness.future
        ? `${estimateDetail} · voluntary check-in has an invalid future timestamp`
        : `${estimateDetail} · last voluntary check-in about ${age} min ago`;
    }
    if (source) {
      source.textContent = freshness.future ? "INVALID TIME · TIMETABLE" : "STALE · TIMETABLE";
      source.title = freshness.future
        ? "This voluntary check-in is too far in the future, so timetable guidance takes priority until fresh server state replaces it."
        : "This voluntary check-in is older than 15 minutes, so timetable guidance takes priority.";
    }
    return true;
  }

  function refresh(now = Date.now()) {
    applyPlanTrustBoundary();
    syncTrustObserver();

    const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const list = document.getElementById("v010StatusList");
    const state = window.NVSSharedLive?.getState?.();
    const members = state?.members && typeof state.members === "object" ? state.members : null;
    if (!list || !members) return 0;

    const rows = [...list.querySelectorAll(".v010-person")];
    let staleCount = 0;
    rows.forEach((row, index) => {
      const entry = members[String(index)];
      if (entry && markStaleRow(row, index, entry, timestamp)) staleCount += 1;
    });
    return staleCount;
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(() => {
      refresh();
      schedule();
    }, UPDATE_MS);
  }

  function start() {
    refresh();
    schedule();
  }

  ["nvs-shared-live-change", "nvs-group-recommendations-rendered", "nvs-live-plan-synced", "nvs-shared-view-resumed", "online"].forEach((name) => {
    window.addEventListener(name, () => refresh());
  });
  window.addEventListener("pageshow", start);
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    trustObserver?.disconnect?.();
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.hidden) trustObserver?.disconnect?.();
    else start();
  });

  window.NVSSharedLiveFreshness0111 = Object.freeze({
    refresh,
    freshnessFor,
    markStaleRow,
    hasPendingPlanUpdate,
    applyPlanTrustBoundary,
  });

  start();
})();