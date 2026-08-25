(() => {
  const STALE_MS = 15 * 60_000;
  const UPDATE_MS = 15_000;
  let timer = null;

  function freshnessFor(entry, now = Date.now()) {
    const core = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (core && typeof core.fresh === "boolean") return core;
    const at = Number(entry?.at);
    if (!Number.isFinite(at)) return { fresh: false, stale: true, ageMs: Infinity, ageMinutes: Infinity };
    const ageMs = Math.max(0, now - at);
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
    if (row.dataset) row.dataset.v0111Freshness = "stale";

    const label = row.querySelector?.("small");
    const detail = row.querySelector?.("em");
    const source = row.querySelector?.(".v010-source");
    if (label) label.textContent = headline;
    if (detail) detail.textContent = `${estimateDetail} · last voluntary check-in about ${age} min ago`;
    if (source) {
      source.textContent = "STALE · TIMETABLE";
      source.title = "This voluntary check-in is older than 15 minutes, so timetable guidance takes priority.";
    }
    return true;
  }

  function refresh(now = Date.now()) {
    const list = document.getElementById("v010StatusList");
    const state = window.NVSSharedLive?.getState?.();
    const members = state?.members && typeof state.members === "object" ? state.members : null;
    if (!list || !members) return 0;

    const rows = [...list.querySelectorAll(".v010-person")];
    let staleCount = 0;
    rows.forEach((row, index) => {
      const entry = members[String(index)];
      if (entry && markStaleRow(row, index, entry, now)) staleCount += 1;
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

  window.addEventListener("nvs-shared-live-change", refresh);
  window.addEventListener("nvs-group-recommendations-rendered", refresh);
  window.addEventListener("pageshow", start);
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) start();
  });

  window.NVSSharedLiveFreshness0111 = Object.freeze({
    refresh,
    freshnessFor,
    markStaleRow,
  });

  start();
})();
