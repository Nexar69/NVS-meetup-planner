(() => {
  const STORAGE_KEY = "meet-schwerin-offline-journey-v1";
  const MAX_AGE_MS = 12 * 60 * 60 * 1000;
  const MAX_SEGMENTS = 12;

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

  function sanitizeSegment(segment) {
    if (!segment || typeof segment !== "object") return null;
    return {
      mode: safeText(segment.mode, 24),
      modeLabel: safeText(segment.modeLabel, 40),
      line: safeText(segment.line, 24),
      from: safeText(segment.from, 120),
      to: safeText(segment.to, 120),
      headsign: safeText(segment.headsign, 120),
      departure: safeIso(segment.departure),
      arrival: safeIso(segment.arrival),
      platformFrom: safeText(segment.platformFrom || segment.plannedPlatformFrom, 40),
      platformTo: safeText(segment.platformTo || segment.plannedPlatformTo, 40),
    };
  }

  function buildSnapshot(assignment, now = new Date()) {
    const route = assignment?.route;
    const segments = Array.isArray(route?.segments)
      ? route.segments.slice(0, MAX_SEGMENTS).map(sanitizeSegment).filter(Boolean)
      : [];
    if (!segments.length) return null;
    return {
      schema: "meet-schwerin-offline-journey-v1",
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
    if (isPersonalSharedView() || focusIndex() >= 0) return true;
    try {
      const path = String(window.location?.pathname || "");
      const query = new URLSearchParams(String(window.location?.search || ""));
      return path.includes("/p/") && query.has("me");
    } catch {
      return false;
    }
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

  function capture(now = new Date()) {
    if (!isPersonalSharedView()) return null;
    const snapshot = buildSnapshot(assignment(), now);
    if (snapshot) writeSnapshot(snapshot);
    return snapshot;
  }

  function readSnapshot(now = Date.now()) {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || parsed.schema !== "meet-schwerin-offline-journey-v1" || !Array.isArray(parsed.segments) || !parsed.segments.length) return null;
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
    const card = ensureCard();
    const steps = snapshot.segments.map((segment) => {
      const time = formatTime(segment.departure);
      const platform = segment.platformFrom ? ` · platform ${escapeHtml(segment.platformFrom)}` : "";
      return `<li><span>${escapeHtml(time || "—")}</span><div><strong>${escapeHtml(segmentTitle(segment))}</strong><small>${escapeHtml(segment.from || "Planned route")}${platform}</small></div></li>`;
    }).join("");
    const arrival = formatTime(snapshot.arrival);
    card.innerHTML = `
      <div class="v0111-offline-journey-head">
        <div><small>OFFLINE FALLBACK</small><h2 id="offlineJourney0111Title">Your saved journey is still available</h2></div>
        <span>Tab only</span>
      </div>
      <p>Realtime updates are unavailable. This is the last timetable plan saved in this tab (${escapeHtml(ageLabel(snapshot.capturedAt))}); check vehicle displays and stop announcements because the route may have changed.</p>
      <ol>${steps}</ol>
      <p class="v0111-offline-journey-meta">${arrival ? `Planned arrival ${escapeHtml(arrival)} · ` : ""}No GPS, names, coordinates, plan IDs or private check-in keys are stored in this fallback.</p>`;
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
  window.addEventListener("load", refresh);

  window.NVSOfflineJourney0111 = Object.freeze({
    buildSnapshot,
    capture,
    readSnapshot,
    personalViewerHint,
    refresh,
  });

  refresh();
})();
