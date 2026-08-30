(() => {
  const STORAGE_KEY = "meet-schwerin-offline-journey-v1";
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const REALTIME_CONTEXT_FRESH_MS = 15 * 60 * 1000;
  const MAX_SEGMENTS = 12;
  const COMPLETED_GRACE_MS = 2 * 60 * 1000;
  let freshnessTimer = null;
  let memorySnapshot = null;

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function safeText(value, max = 120) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function safeIso(value) {
    return asDate(value)?.toISOString() || null;
  }

  function firstDisruptionText(segment) {
    const direct = safeText(segment?.remark || segment?.disruption || "", 180);
    if (direct) return direct;
    const remarks = Array.isArray(segment?.remarks) ? segment.remarks : [];
    for (const item of remarks) {
      const text = safeText(typeof item === "string" ? item : item?.text || item?.summary || item?.title || "", 180);
      if (text) return text;
    }
    return "";
  }

  function sanitizeSegment(segment) {
    if (!segment || typeof segment !== "object") return null;
    const plannedPlatformFrom = safeText(segment.plannedPlatformFrom, 40);
    const platformFrom = safeText(segment.platformFrom || plannedPlatformFrom, 40);
    return {
      mode: safeText(segment.mode, 24),
      modeLabel: safeText(segment.modeLabel, 40),
      line: safeText(segment.line, 24),
      from: safeText(segment.from, 120),
      to: safeText(segment.to, 120),
      headsign: safeText(segment.headsign, 120),
      departure: safeIso(segment.departure),
      arrival: safeIso(segment.arrival),
      platformFrom,
      plannedPlatformFrom,
      platformChanged: Boolean(platformFrom && plannedPlatformFrom && platformFrom !== plannedPlatformFrom),
      platformTo: safeText(segment.platformTo || segment.plannedPlatformTo, 40),
      cancelled: Boolean(segment.cancelled),
      disruption: firstDisruptionText(segment),
    };
  }

  function personalScopeSource() {
    try {
      const path = String(window.location?.pathname || "");
      const query = new URLSearchParams(String(window.location?.search || ""));
      const member = query.get("me");
      return path.includes("/p/") && member != null ? `${path}?me=${member}` : "";
    } catch {
      return "";
    }
  }

  function scopeFingerprint() {
    const source = personalScopeSource();
    if (!source) return "";
    let first = 0x811c9dc5;
    let second = 0x9e3779b1;
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193) >>> 0;
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b) >>> 0;
    }
    return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
  }

  function authoritativeExpiry() {
    try {
      return safeIso(window.NVSSharedLive?.getState?.()?.expiresAt);
    } catch {
      return null;
    }
  }

  function buildSnapshot(assignment, now = new Date()) {
    const route = assignment?.route;
    const segments = Array.isArray(route?.segments)
      ? route.segments.slice(0, MAX_SEGMENTS).map(sanitizeSegment).filter(Boolean)
      : [];
    const scope = scopeFingerprint();
    if (!segments.length || !scope) return null;
    return {
      schema: "meet-schwerin-offline-journey-v1",
      scope,
      capturedAt: now.toISOString(),
      expiresAt: authoritativeExpiry(),
      arrival: safeIso(route.arrival),
      segments,
    };
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function isPersonalSharedView() {
    return Boolean(window.NVSShare?.getSharedPlan?.() && focusIndex() >= 0);
  }

  function personalViewerHint() {
    return isPersonalSharedView() || focusIndex() >= 0 || Boolean(personalScopeSource());
  }

  function assignment() {
    const items = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    const focus = focusIndex();
    return Array.isArray(items) && focus >= 0 ? items[focus] : null;
  }

  function snapshotUsable(snapshot, now = Date.now()) {
    const expectedScope = scopeFingerprint();
    if (!snapshot || snapshot.schema !== "meet-schwerin-offline-journey-v1" || !expectedScope || snapshot.scope !== expectedScope || !Array.isArray(snapshot.segments) || !snapshot.segments.length) return false;
    const captured = asDate(snapshot.capturedAt)?.getTime();
    const expiresAt = asDate(snapshot.expiresAt)?.getTime();
    return Boolean(
      Number.isFinite(captured)
      && Number(now) - captured <= MAX_AGE_MS
      && captured - Number(now) <= 5 * 60_000
      && (!Number.isFinite(expiresAt) || Number(now) < expiresAt),
    );
  }

  function writeSnapshot(snapshot) {
    if (!snapshot) return false;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      memorySnapshot = null;
      return true;
    } catch {
      memorySnapshot = snapshot;
      return false;
    }
  }

  function clearFreshnessTimer() {
    if (freshnessTimer && typeof clearTimeout === "function") clearTimeout(freshnessTimer);
    freshnessTimer = null;
  }

  function clearSnapshot() {
    clearFreshnessTimer();
    memorySnapshot = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    removeCard();
  }

  function capture(now = new Date()) {
    if (!isPersonalSharedView()) return null;
    const snapshot = buildSnapshot(assignment(), now);
    if (snapshot) writeSnapshot(snapshot);
    return snapshot;
  }

  function snapshotCapturedAtMs(snapshot) {
    const captured = asDate(snapshot?.capturedAt)?.getTime();
    return Number.isFinite(captured) ? captured : -Infinity;
  }

  function strictestExpiry(snapshot, other) {
    const expiry = asDate(snapshot?.expiresAt)?.getTime();
    const otherExpiry = asDate(other?.expiresAt)?.getTime();
    if (!Number.isFinite(otherExpiry) || (Number.isFinite(expiry) && expiry <= otherExpiry)) return snapshot;
    return { ...snapshot, expiresAt: new Date(otherExpiry).toISOString() };
  }

  function readSnapshot(now = Date.now()) {
    let parsed = null;
    try {
      parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      parsed = null;
    }

    const persistedUsable = Boolean(parsed && snapshotUsable(parsed, now));
    const memoryUsable = Boolean(memorySnapshot && snapshotUsable(memorySnapshot, now));

    if (parsed && !persistedUsable) {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      parsed = null;
    }
    if (memorySnapshot && !memoryUsable) memorySnapshot = null;

    if (persistedUsable && memoryUsable) {
      if (snapshotCapturedAtMs(memorySnapshot) > snapshotCapturedAtMs(parsed)) {
        const selected = strictestExpiry(memorySnapshot, parsed);
        writeSnapshot(selected);
        return selected;
      }
      memorySnapshot = null;
      return strictestExpiry(parsed, memorySnapshot);
    }

    if (memoryUsable) {
      const selected = memorySnapshot;
      writeSnapshot(selected);
      return selected;
    }
    if (persistedUsable) return parsed;
    return null;
  }

  function reconcileAuthoritativeExpiry(now = Date.now()) {
    const snapshot = readSnapshot(now);
    if (!snapshot) return null;
    const expiresAt = authoritativeExpiry();
    const expiryMs = asDate(expiresAt)?.getTime();
    if (!Number.isFinite(expiryMs)) return snapshot;
    if (Number(now) >= expiryMs) {
      clearSnapshot();
      return null;
    }
    if (snapshot.expiresAt === expiresAt) return snapshot;
    const reconciled = { ...snapshot, expiresAt };
    writeSnapshot(reconciled);
    return reconciled;
  }

  function snapshotAgeMs(snapshot, now = Date.now()) {
    const captured = asDate(snapshot?.capturedAt)?.getTime();
    if (!Number.isFinite(captured)) return Infinity;
    return Math.max(0, Number(now) - captured);
  }

  function realtimeContextFresh(snapshot, now = Date.now()) {
    const age = snapshotAgeMs(snapshot, now);
    return Number.isFinite(age) && age <= REALTIME_CONTEXT_FRESH_MS;
  }

  function nextOfflineBoundary(snapshot, now = Date.now()) {
    const current = Number(now);
    const captured = asDate(snapshot?.capturedAt)?.getTime();
    if (!Number.isFinite(current) || !Number.isFinite(captured)) return null;
    const boundaries = [captured + MAX_AGE_MS + 1];
    if (realtimeContextFresh(snapshot, current)) boundaries.push(captured + REALTIME_CONTEXT_FRESH_MS + 1);
    const expiresAt = asDate(snapshot?.expiresAt)?.getTime();
    if (Number.isFinite(expiresAt)) boundaries.push(expiresAt);
    const future = boundaries.filter((value) => Number.isFinite(value) && value > current);
    return future.length ? Math.min(...future) : null;
  }

  function scheduleFreshnessRefresh(snapshot, now = Date.now()) {
    clearFreshnessTimer();
    if (document.hidden || typeof setTimeout !== "function") return null;
    const boundary = nextOfflineBoundary(snapshot, now);
    if (!Number.isFinite(boundary)) return null;
    const delay = Math.max(25, boundary - Number(now) + 25);
    freshnessTimer = setTimeout(() => {
      freshnessTimer = null;
      render();
    }, delay);
    return delay;
  }

  function remainingSegments(snapshot, now = Date.now()) {
    const segments = Array.isArray(snapshot?.segments) ? snapshot.segments.filter(Boolean) : [];
    if (!segments.length) return [];
    const remaining = segments.filter((segment) => {
      const arrival = asDate(segment.arrival)?.getTime();
      return !Number.isFinite(arrival) || arrival >= now - COMPLETED_GRACE_MS;
    });
    return remaining.length ? remaining : segments.slice(-1);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "";
  }

  function ageLabel(value) {
    const at = asDate(value)?.getTime();
    if (!Number.isFinite(at)) return "saved earlier";
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
    if (minutes < 2) return "saved just now";
    if (minutes < 60) return `saved ${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return `saved about ${hours} h ago`;
  }

  function segmentTitle(segment) {
    if (String(segment.mode || "").toUpperCase() === "WALK") return `Walk to ${segment.to || "the next stop"}`;
    const mode = segment.modeLabel || segment.mode || "Transit";
    const vehicle = segment.line ? `${mode} ${segment.line}` : mode;
    return `${vehicle} to ${segment.to || "the next stop"}`;
  }

  function segmentStatus(segment, realtimeFresh = true) {
    const platformChange = segment.platformChanged
      ? ` · platform changed ${segment.plannedPlatformFrom} → ${segment.platformFrom}`
      : "";
    if (segment.cancelled) {
      const note = segment.disruption ? ` · ${segment.disruption}` : "";
      return realtimeFresh
        ? `Cancelled when last online${platformChange}${note}`
        : `Stale last-known cancellation${platformChange}${note}`;
    }
    if (segment.disruption) {
      return realtimeFresh
        ? `Last-known disruption: ${segment.disruption}${platformChange}`
        : `Stale last-known disruption: ${segment.disruption}${platformChange}`;
    }
    if (!segment.platformChanged) return "";
    return realtimeFresh
      ? `Last-known platform change: ${segment.plannedPlatformFrom} → ${segment.platformFrom}`
      : `Stale last-known platform change: ${segment.plannedPlatformFrom} → ${segment.platformFrom}`;
  }

  function removeCard() {
    document.getElementById("offlineJourney0111")?.remove();
  }

  function ensureCard() {
    let card = document.getElementById("offlineJourney0111");
    if (card) return card;
    card = document.createElement("section");
    card.id = "offlineJourney0111";
    card.className = "v0111-offline-journey";
    card.setAttribute("aria-labelledby", "offlineJourney0111Title");
    card.setAttribute("role", "status");
    const personal = document.getElementById("personalSharedPlan");
    if (personal) personal.insertAdjacentElement("afterend", card);
    else if (document.getElementById("results")) document.getElementById("results").prepend(card);
    else document.querySelector("main.app")?.prepend(card);
    return card;
  }

  function renderUnavailable() {
    clearFreshnessTimer();
    const card = ensureCard();
    card.setAttribute("data-connection", "offline");
    card.innerHTML = `
      <div class="v0111-offline-journey-head">
        <div><small>OFFLINE</small><h2 id="offlineJourney0111Title">No saved journey is available in this tab</h2></div>
        <span>Tab only</span>
      </div>
      <p>Reconnect while this personal route is open to load the current plan and create a temporary offline fallback for this tab.</p>
      <p class="v0111-offline-journey-meta">Meet Schwerin does not persist personal route fallbacks beyond this tab, and it never adds background GPS for offline mode.</p>`;
  }

  function hasUsableLiveRoute() {
    const liveAssignment = assignment();
    const personalPlan = document.getElementById("personalSharedPlan");
    return Boolean(liveAssignment?.route?.segments?.length && personalPlan);
  }

  function render() {
    if (!personalViewerHint()) {
      clearFreshnessTimer();
      removeCard();
      return;
    }
    if (hasUsableLiveRoute()) {
      clearFreshnessTimer();
      removeCard();
      return;
    }
    const snapshot = readSnapshot();
    if (!snapshot) {
      if (navigator.onLine) {
        clearFreshnessTimer();
        removeCard();
      } else {
        renderUnavailable();
      }
      return;
    }
    const reconnecting = Boolean(navigator.onLine);
    const visibleSegments = remainingSegments(snapshot);
    const realtimeFresh = realtimeContextFresh(snapshot);
    scheduleFreshnessRefresh(snapshot);
    const card = ensureCard();
    card.setAttribute("data-connection", reconnecting ? "reconnecting" : "offline");
    const steps = visibleSegments.map((segment) => {
      const time = formatTime(segment.departure);
      const platformLabel = realtimeFresh ? "platform" : "last-known platform";
      const platform = segment.platformFrom ? ` · ${platformLabel} ${escapeHtml(segment.platformFrom)}` : "";
      const status = segmentStatus(segment, realtimeFresh);
      const statusCopy = status ? `<small><strong>${escapeHtml(status)}</strong></small>` : "";
      return `<li><span>${escapeHtml(time || "—")}</span><div><strong>${escapeHtml(segmentTitle(segment))}</strong><small>${escapeHtml(segment.from || "Planned route")}${platform}</small>${statusCopy}</div></li>`;
    }).join("");
    const arrival = formatTime(snapshot.arrival);
    const hasCancelled = visibleSegments.some((segment) => segment.cancelled);
    const safetyCopy = !realtimeFresh
      ? "Saved realtime details are more than 15 minutes old. Treat platform changes, cancellations and disruption notes as historical only; verify them on station/vehicle displays or reconnect before relying on them."
      : hasCancelled
        ? "At least one remaining saved leg was already cancelled when you were last online. Do not rely on that leg; use station/vehicle information or reconnect before continuing."
        : reconnecting
          ? "Your device reports a connection, but the current personal route has not loaded again yet. Keep using this saved journey as a fallback until live route data returns."
          : "Realtime updates are unavailable. This is the remaining part of the last timetable plan saved in this tab; check vehicle displays and stop announcements because the route may have changed.";
    card.innerHTML = `
      <div class="v0111-offline-journey-head">
        <div><small>${reconnecting ? "RECONNECTING · SAVED FALLBACK" : "OFFLINE FALLBACK"}</small><h2 id="offlineJourney0111Title">${reconnecting ? "Keeping your saved journey until live data returns" : "Your saved journey is still available"}</h2></div>
        <span>Tab only</span>
      </div>
      <p>${escapeHtml(safetyCopy)} (${escapeHtml(ageLabel(snapshot.capturedAt))})</p>
      <ol>${steps}</ol>
      <p class="v0111-offline-journey-meta">${arrival ? `Planned arrival ${escapeHtml(arrival)} · ` : ""}Completed legs are hidden when possible. Authoritative shared-session expiry is honored offline when known, including while reconnecting. No GPS, names, coordinates, plan IDs or private check-in keys are stored in this fallback.</p>`;
  }

  function captureAndRender() {
    if (navigator.onLine) capture();
    render();
  }

  function resumeRender() {
    render();
  }

  function reconcileExpiryAndRender() {
    if (navigator.onLine) reconcileAuthoritativeExpiry();
    render();
  }

  window.addEventListener("nvs-group-recommendations-rendered", captureAndRender);
  window.addEventListener("nvs-live-plan-synced", reconcileExpiryAndRender);
  window.addEventListener("online", resumeRender);
  window.addEventListener("offline", render);
  window.addEventListener("pageshow", resumeRender);
  window.addEventListener("nvs-shared-view-resumed", resumeRender);
  window.addEventListener("nvs-shared-session-expired", clearSnapshot);
  window.addEventListener("load", captureAndRender);
  document.addEventListener?.("visibilitychange", () => {
    if (document.hidden) clearFreshnessTimer();
    else render();
  });

  window.NVSOfflineJourney0111 = Object.freeze({
    buildSnapshot,
    capture,
    readSnapshot,
    reconcileAuthoritativeExpiry,
    snapshotAgeMs,
    realtimeContextFresh,
    nextOfflineBoundary,
    scheduleFreshnessRefresh,
    remainingSegments,
    clearSnapshot,
    personalViewerHint,
    scopeFingerprint,
    authoritativeExpiry,
    hasUsableLiveRoute,
    captureAndRender,
    resumeRender,
    reconcileExpiryAndRender,
  });

  captureAndRender();
})();