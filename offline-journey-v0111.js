(() => {
  const STORAGE_KEY = "meet-schwerin-offline-journey-v1";
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const MAX_SEGMENTS = 12;
  const COMPLETED_GRACE_MS = 2 * 60 * 1000;

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

  function writeSnapshot(snapshot) {
    if (!snapshot) return false;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch {
      return false;
    }
  }

  function clearSnapshot() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
    removeCard();
  }

  function capture(now = new Date()) {
    if (!isPersonalSharedView()) return null;
    const snapshot = buildSnapshot(assignment(), now);
    if (snapshot) writeSnapshot(snapshot);
    return snapshot;
  }

  function readSnapshot(now = Date.now()) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      const expectedScope = scopeFingerprint();
      if (!parsed || parsed.schema !== "meet-schwerin-offline-journey-v1" || !expectedScope || parsed.scope !== expectedScope || !Array.isArray(parsed.segments) || !parsed.segments.length) {
        if (parsed) sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      const captured = asDate(parsed.capturedAt)?.getTime();
      if (!Number.isFinite(captured) || now - captured > MAX_AGE_MS || captured - now > 5 * 60_000) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
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

  function segmentStatus(segment) {
    const platformChange = segment.platformChanged
      ? ` · platform changed ${segment.plannedPlatformFrom} → ${segment.platformFrom}`
      : "";
    if (segment.cancelled) {
      const note = segment.disruption ? ` · ${segment.disruption}` : "";
      return `Cancelled when last online${platformChange}${note}`;
    }
    if (segment.disruption) return `Last-known disruption: ${segment.disruption}${platformChange}`;
    return segment.platformChanged ? `Last-known platform change: ${segment.plannedPlatformFrom} → ${segment.platformFrom}` : "";
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

  function render() {
    if (!personalViewerHint() || navigator.onLine) {
      removeCard();
      return;
    }
    const liveAssignment = assignment();
    const personalPlan = document.getElementById("personalSharedPlan");
    if (liveAssignment?.route?.segments?.length && personalPlan) {
      removeCard();
      return;
    }
    const snapshot = readSnapshot();
    if (!snapshot) {
      removeCard();
      return;
    }
    const visibleSegments = remainingSegments(snapshot);
    const card = ensureCard();
    const steps = visibleSegments.map((segment) => {
      const time = formatTime(segment.departure);
      const platform = segment.platformFrom ? ` · platform ${escapeHtml(segment.platformFrom)}` : "";
      const status = segmentStatus(segment);
      const statusCopy = status ? `<small><strong>${escapeHtml(status)}</strong></small>` : "";
      return `<li><span>${escapeHtml(time || "—")}</span><div><strong>${escapeHtml(segmentTitle(segment))}</strong><small>${escapeHtml(segment.from || "Planned route")}${platform}</small>${statusCopy}</div></li>`;
    }).join("");
    const arrival = formatTime(snapshot.arrival);
    const hasCancelled = visibleSegments.some((segment) => segment.cancelled);
    const safetyCopy = hasCancelled
      ? "At least one remaining saved leg was already cancelled when you were last online. Do not rely on that leg; use station/vehicle information or reconnect before continuing."
      : "Realtime updates are unavailable. This is the remaining part of the last timetable plan saved in this tab; check vehicle displays and stop announcements because the route may have changed.";
    card.innerHTML = `
      <div class="v0111-offline-journey-head">
        <div><small>OFFLINE FALLBACK</small><h2 id="offlineJourney0111Title">Your saved journey is still available</h2></div>
        <span>Tab only</span>
      </div>
      <p>${escapeHtml(safetyCopy)} (${escapeHtml(ageLabel(snapshot.capturedAt))})</p>
      <ol>${steps}</ol>
      <p class="v0111-offline-journey-meta">${arrival ? `Planned arrival ${escapeHtml(arrival)} · ` : ""}Completed legs are hidden when possible. No GPS, names, coordinates, plan IDs or private check-in keys are stored in this fallback.</p>`;
  }

  function refresh() {
    if (navigator.onLine) capture();
    render();
  }

  window.addEventListener("nvs-group-recommendations-rendered", refresh);
  window.addEventListener("nvs-live-plan-synced", refresh);
  window.addEventListener("online", refresh);
  window.addEventListener("offline", render);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("nvs-shared-view-resumed", refresh);
  window.addEventListener("nvs-shared-session-expired", clearSnapshot);
  window.addEventListener("load", refresh);

  window.NVSOfflineJourney0111 = Object.freeze({
    buildSnapshot,
    capture,
    readSnapshot,
    remainingSegments,
    clearSnapshot,
    personalViewerHint,
    scopeFingerprint,
    refresh,
  });

  refresh();
})();
