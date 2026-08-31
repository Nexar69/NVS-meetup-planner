(() => {
  const FORCE_WINDOW_MS = 8_000;
  const PRE_TRIP_GUARD_MS = 15 * 60_000;
  const POST_TRIP_GUARD_MS = 5 * 60_000;
  let forceUntil = 0;
  let resetTimer = null;
  let lifecycleFrozen = false;

  function asTime(value) {
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
  }

  function focusedAssignment() {
    const items = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    if (!Array.isArray(items) || !items.length) return null;
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(focus) && focus >= 0 ? items[focus] || null : items[0] || null;
  }

  function routeWindow(route) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    if (!segments.length) return null;
    const starts = segments.map((segment) => asTime(segment.departure)).filter(Number.isFinite);
    const ends = segments.map((segment) => asTime(segment.arrival)).filter(Number.isFinite);
    if (!starts.length || !ends.length) return null;
    const start = Math.min(...starts);
    const end = Math.max(...ends);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { start, end };
  }

  function isJourneyActive(now = Date.now()) {
    if (document.getElementById("v011TripDialog")?.open) return true;
    const assignment = focusedAssignment();
    const window = routeWindow(assignment?.route);
    if (!window) return false;
    const stamp = Number(now);
    return Number.isFinite(stamp)
      && stamp >= window.start - PRE_TRIP_GUARD_MS
      && stamp <= window.end + POST_TRIP_GUARD_MS;
  }

  function updateButtonFromEvent(event) {
    const target = event?.target;
    if (!target) return null;
    if (target.matches?.("#v011UpdateBanner button")) return target;
    return target.closest?.("#v011UpdateBanner button") || null;
  }

  function restoreBanner() {
    if (lifecycleFrozen) return;
    clearTimeout(resetTimer);
    resetTimer = null;
    forceUntil = 0;
    const banner = document.getElementById("v011UpdateBanner");
    if (!banner || banner.hidden) return;
    const strong = banner.querySelector?.("strong");
    const small = banner.querySelector?.("small");
    const button = banner.querySelector?.("button");
    if (strong) strong.textContent = "Meet Schwerin update ready";
    if (small) small.textContent = "A newer app shell has finished downloading.";
    if (button) button.textContent = "Reload update";
    banner.removeAttribute?.("data-update-deferred");
  }

  function armRestoreTimer(now = Date.now()) {
    clearTimeout(resetTimer);
    resetTimer = null;
    if (lifecycleFrozen) return;
    const remaining = forceUntil - Number(now);
    if (!forceUntil || !Number.isFinite(remaining) || remaining <= 0) {
      if (forceUntil) restoreBanner();
      return;
    }
    if (document.hidden) return;
    resetTimer = setTimeout(restoreBanner, remaining);
  }

  function showDeferredWarning(button, now = Date.now()) {
    if (lifecycleFrozen) return;
    const banner = button?.closest?.("#v011UpdateBanner") || document.getElementById("v011UpdateBanner");
    if (!banner) return;
    forceUntil = Number(now) + FORCE_WINDOW_MS;
    banner.setAttribute?.("data-update-deferred", "true");
    const strong = banner.querySelector?.("strong");
    const small = banner.querySelector?.("small");
    if (strong) strong.textContent = "Trip active — update deferred";
    if (small) small.textContent = "Tap again within 8 seconds to reload now, or wait until your journey is finished.";
    if (button) button.textContent = "Update now anyway";
    armRestoreTimer(now);
  }

  function handleUpdateClick(event, now = Date.now()) {
    if (lifecycleFrozen) return false;
    const button = updateButtonFromEvent(event);
    if (!button) return false;
    const stamp = Number(now);
    if (!isJourneyActive(stamp)) {
      restoreBanner();
      return false;
    }
    if (forceUntil && stamp <= forceUntil) {
      restoreBanner();
      return false;
    }
    if (forceUntil && stamp > forceUntil) restoreBanner();
    event.preventDefault?.();
    event.stopPropagation?.();
    event.stopImmediatePropagation?.();
    showDeferredWarning(button, stamp);
    return true;
  }

  function handlePageHide() {
    lifecycleFrozen = true;
    clearTimeout(resetTimer);
    resetTimer = null;
  }

  function handlePageShow() {
    lifecycleFrozen = false;
    restoreBanner();
  }

  document.addEventListener("click", handleUpdateClick, true);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("nvs-group-recommendations-rendered", () => {
    if (lifecycleFrozen) return;
    if (!isJourneyActive()) restoreBanner();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || lifecycleFrozen) {
      clearTimeout(resetTimer);
      resetTimer = null;
      return;
    }
    armRestoreTimer();
  });

  window.NVSUpdateSafety0111 = Object.freeze({
    isJourneyActive,
    handleUpdateClick,
    restoreBanner,
    routeWindow,
  });
})();
