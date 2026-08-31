(() => {
  const SYNC_MS = 30_000;
  const SETTLE_MS = 60;
  const OVERRIDE_STATUSES = new Set(["missed", "arrived", "on-vehicle", "at-stop"]);
  let timer = null;
  let reconcileTimer = null;
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments?.length);
  let lifecycleFrozen = false;

  function loadCheckinQueueAssets() {
    if (typeof document.querySelector !== "function" || typeof document.createElement !== "function") return;
    if (!document.querySelector('link[data-shared-checkin-queue-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./shared-checkin-queue-v0111.css";
      link.dataset.sharedCheckinQueueV0111 = "true";
      document.head?.appendChild?.(link);
    }
    if (!document.querySelector('script[data-shared-checkin-queue-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./shared-checkin-queue-v0111.js";
      script.async = false;
      script.dataset.sharedCheckinQueueV0111 = "true";
      document.body?.appendChild?.(script);
    }
  }

  function asNow(value = Date.now()) {
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Date.now();
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) && value >= 0 ? value : -1;
  }

  function focusedAssignment() {
    const items = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    const focus = focusIndex();
    return Array.isArray(items) && focus >= 0 ? items[focus] || null : null;
  }

  function freshEntry(now = Date.now()) {
    const focus = focusIndex();
    if (focus < 0) return null;
    const entry = window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
    if (!entry || !OVERRIDE_STATUSES.has(entry.status)) return null;
    const stamp = asNow(now);
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(stamp));
    if (freshness) return freshness.fresh ? entry : null;
    const at = Number(entry.at);
    return Number.isFinite(at) && stamp >= at && stamp - at <= 15 * 60_000 ? entry : null;
  }

  function fallbackModel(entry) {
    if (entry?.status === "missed") return {
      pill: "RECOVERY",
      title: "You reported a missed connection",
      detail: "Your voluntary update is newer than the timetable assumption. Use the Recovery Desk or replan before relying on the old next step.",
      nextTitle: "Recover this journey",
      nextDetail: "Check Recovery Desk or refresh the planner for a route that matches what happened.",
    };
    if (entry?.status === "arrived") return {
      pill: "CONFIRMED",
      title: "You're at the meetup",
      detail: "Your voluntary arrival check-in is the current source of truth for this view.",
      nextTitle: "Meetup confirmed by you",
      nextDetail: "The group can see your voluntary arrival status.",
    };
    if (entry?.status === "on-vehicle") return {
      pill: "CONFIRMED",
      title: "Confirmed on board",
      detail: "Your voluntary check-in says you're on a vehicle; timetable guidance remains secondary to that update.",
    };
    if (entry?.status === "at-stop") return {
      pill: "CONFIRMED",
      title: "You're at a stop",
      detail: "Your voluntary check-in is more current than any contradictory timetable-only riding state.",
    };
    return null;
  }

  function modelForEntry(route, entry, now = Date.now()) {
    if (!entry || !OVERRIDE_STATUSES.has(entry.status)) return null;
    const guidance = window.NVSTripGuidance0111?.guidanceForRoute?.(route, asNow(now), entry) || null;
    const fallback = fallbackModel(entry);
    if (!guidance) return fallback;
    return {
      ...(fallback || {}),
      pill: fallback?.pill || "CONFIRMED",
      title: guidance.title || fallback?.title || "Voluntary status confirmed",
      detail: guidance.detail || fallback?.detail || "Your voluntary status is being used for current guidance.",
    };
  }

  function setText(node, value) {
    const next = String(value || "");
    if (node && node.textContent !== next) node.textContent = next;
  }

  function setHtml(node, value) {
    if (node && node.innerHTML !== value) node.innerHTML = value;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sync(now = Date.now()) {
    if (lifecycleFrozen) return false;
    const assignment = focusedAssignment();
    const entry = freshEntry(now);
    if (!assignment?.route || !entry) return false;
    const model = modelForEntry(assignment.route, entry, now);
    if (!model) return false;

    const current = document.getElementById("v011CurrentAction");
    if (current) {
      setHtml(current, `<span>NOW · VOLUNTARY</span><strong>${escapeHtml(model.title)}</strong><small>${escapeHtml(model.detail)}</small>`);
    }

    const dialog = document.getElementById("v011TripDialog");
    if (dialog) {
      setText(dialog.querySelector?.("#v011TripPill"), model.pill || "CONFIRMED");
      setText(dialog.querySelector?.("#v011TripAction"), model.title);
      setText(dialog.querySelector?.("#v011TripDetail"), model.detail);
      if (model.nextTitle) {
        const next = dialog.querySelector?.("#v011TripNext");
        setHtml(next, `<span>NEXT</span><strong>${escapeHtml(model.nextTitle)}</strong><small>${escapeHtml(model.nextDetail || "")}</small>`);
      }
    }
    return true;
  }

  function cancelScheduledSync() {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = null;
  }

  function clearPeriodicSync() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function hideRecommendationSurfaces() {
    if (lifecycleFrozen) return false;
    const panel = document.getElementById("v011CommandCenter");
    panel?.classList?.remove?.("visible");
    const dialog = document.getElementById("v011TripDialog");
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    return true;
  }

  function clearRecommendationSurfaces() {
    recommendationsActive = false;
    clearPeriodicSync();
    cancelScheduledSync();
    hideRecommendationSurfaces();
  }

  function activateRecommendations() {
    recommendationsActive = true;
    if (!lifecycleFrozen) schedule();
  }

  function schedule(delay = SETTLE_MS) {
    if (lifecycleFrozen || document.hidden || !recommendationsActive) return;
    cancelScheduledSync();
    reconcileTimer = setTimeout(() => {
      reconcileTimer = null;
      if (lifecycleFrozen) return;
      sync();
      arm();
    }, Math.max(0, Number(delay) || 0));
  }

  function arm() {
    clearPeriodicSync();
    if (lifecycleFrozen || document.hidden || !recommendationsActive) return;
    timer = setTimeout(() => {
      if (lifecycleFrozen) return;
      sync();
      arm();
    }, SYNC_MS);
  }

  [
    "nvs-shared-live-change",
    "nvs-live-plan-synced",
    "nvs-shared-view-resumed",
  ].forEach((name) => {
    window.addEventListener(name, () => schedule());
  });
  window.addEventListener("nvs-group-recommendations-rendered", activateRecommendations);
  window.addEventListener("nvs-recommendations-cleared", clearRecommendationSurfaces);
  window.addEventListener("pagehide", () => {
    lifecycleFrozen = true;
    clearPeriodicSync();
    cancelScheduledSync();
  });
  window.addEventListener("pageshow", () => {
    lifecycleFrozen = false;
    if (!recommendationsActive) {
      hideRecommendationSurfaces();
      return;
    }
    schedule();
    arm();
  });

  document.addEventListener("visibilitychange", () => {
    if (lifecycleFrozen) return;
    if (document.hidden) {
      clearPeriodicSync();
      cancelScheduledSync();
    } else {
      schedule();
      arm();
    }
  });

  loadCheckinQueueAssets();
  window.NVSIntelligenceVoluntarySync0111 = Object.freeze({
    modelForEntry,
    sync,
    freshEntry,
    schedule,
    clearRecommendationSurfaces,
    isLifecycleFrozen: () => lifecycleFrozen,
  });
  schedule(0);
  arm();
})();