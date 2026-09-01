(() => {
  const UPDATE_MS = 20_000;
  const MAX_WATCH_MIN = 6;
  const MAX_LEAD_MIN = 30;
  const MAX_FUTURE_SKEW_MS = 5 * 60_000;
  const STALE_AFTER_MS = 15 * 60_000;
  const BLOCKING_VOLUNTARY = new Set(["missed", "arrived", "at-stop"]);
  let timer = null;
  let lastMarkup = "";
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments?.length);
  let lifecycleFrozen = false;

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
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

  function isTransit(segment) {
    const mode = String(segment?.mode || "").toUpperCase();
    return Boolean(mode) && !["WALK", "BIKE", "BICYCLE", "CAR"].includes(mode);
  }

  function vehicleLabel(segment) {
    const instruction = window.NVSInstructions?.instructionFor?.(segment);
    if (instruction?.title) return String(instruction.title);
    const mode = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    return line && !mode.toLowerCase().includes(line.toLowerCase()) ? `${mode} ${line}` : mode;
  }

  function cleanPlatform(value) {
    return String(value || "").trim();
  }

  function platformChange(segment) {
    const planned = cleanPlatform(segment?.plannedPlatformFrom);
    const current = cleanPlatform(segment?.platformFrom);
    if (!planned || !current || planned === current) return null;
    return { planned, current };
  }

  function cancelled(segment) {
    return segment?.cancelled === true || segment?.isCancelled === true;
  }

  function disruptionSummary(segment) {
    const remarks = Array.isArray(segment?.remarks) ? segment.remarks : [];
    const first = remarks.find((item) => {
      const text = typeof item === "string" ? item : item?.text || item?.summary || item?.title;
      return String(text || "").trim();
    });
    if (!first) return "";
    const text = typeof first === "string" ? first : first?.text || first?.summary || first?.title;
    return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
  }

  function transferGapMs(current, next) {
    const arrival = asDate(current?.arrival)?.getTime();
    const departure = asDate(next?.departure)?.getTime();
    if (!Number.isFinite(arrival) || !Number.isFinite(departure)) return null;
    return departure - arrival;
  }

  function transferGapMinutes(current, next) {
    const gapMs = transferGapMs(current, next);
    if (!Number.isFinite(gapMs)) return null;
    if (gapMs < 0) return -Math.max(1, Math.ceil(Math.abs(gapMs) / 60_000));
    return Math.floor(gapMs / 60_000);
  }

  function transferCandidates(route, now = Date.now()) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    const candidates = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
      const current = segments[index];
      const next = segments[index + 1];
      if (!isTransit(current) || !isTransit(next)) continue;
      const arrival = asDate(current.arrival);
      const departure = asDate(next.departure);
      if (!arrival || !departure || departure.getTime() <= now) continue;
      const leadMinutes = (departure.getTime() - now) / 60_000;
      if (leadMinutes > MAX_LEAD_MIN) continue;
      const gapMs = transferGapMs(current, next);
      if (!Number.isFinite(gapMs) || gapMs > MAX_WATCH_MIN * 60_000) continue;
      const gap = transferGapMinutes(current, next);
      candidates.push({ index, current, next, gap, gapMs, arrival, departure, leadMinutes });
    }
    return candidates.sort((a, b) => a.departure - b.departure);
  }

  function transferModel(route, now = Date.now()) {
    const transfer = transferCandidates(route, now)[0] || null;
    if (!transfer) return null;
    const stop = String(transfer.current?.to || transfer.next?.from || "your transfer stop");
    const currentVehicle = vehicleLabel(transfer.current);
    const nextVehicle = vehicleLabel(transfer.next);
    const platform = cleanPlatform(transfer.next?.platformFrom);
    const platformDrift = platformChange(transfer.next);
    const departure = formatTime(transfer.next?.departure);
    const untilDeparture = Math.max(0, Math.ceil(transfer.leadMinutes));
    const platformCopy = platformDrift
      ? ` Platform changed from ${platformDrift.planned} to ${platformDrift.current}; follow the live platform signs.`
      : platform
        ? ` Platform ${platform}.`
        : "";

    if (cancelled(transfer.current) || cancelled(transfer.next)) {
      const nextCancelled = cancelled(transfer.next);
      const affected = nextCancelled ? nextVehicle : currentVehicle;
      const remark = disruptionSummary(nextCancelled ? transfer.next : transfer.current);
      return {
        tone: "critical",
        eyebrow: "Connection protection · cancelled",
        title: `${affected} is cancelled`,
        detail: `${nextCancelled ? `The planned onward service from ${stop}` : "The service feeding this transfer"} is marked cancelled in realtime data.${platformCopy}${remark ? ` Provider note: ${remark}.` : ""} Use Recovery Desk or replan instead of relying on this connection.`,
        gap: transfer.gap,
        gapMs: transfer.gapMs,
        stop,
        segmentIndex: nextCancelled ? transfer.index + 1 : transfer.index,
        platformChanged: Boolean(platformDrift),
        cancelledSegment: nextCancelled ? "next" : "current",
      };
    }

    if (transfer.gapMs < 0) {
      return {
        tone: "critical",
        eyebrow: "Connection protection",
        title: "This planned connection no longer fits",
        detail: `${nextVehicle} is due to leave ${stop} about ${Math.max(1, Math.ceil(Math.abs(transfer.gapMs) / 60_000))} min before the previous leg arrives.${platformCopy} Use Recovery Desk or replan instead of relying on this transfer.`,
        gap: transfer.gap,
        gapMs: transfer.gapMs,
        stop,
        segmentIndex: transfer.index + 1,
        platformChanged: Boolean(platformDrift),
      };
    }
    const tight = transfer.gapMs <= 3 * 60_000;
    const tone = tight || platformDrift ? "warn" : "info";
    const eyebrow = platformDrift
      ? "Connection protection · platform changed"
      : tight
        ? "Connection protection · tight"
        : "Connection protection";
    return {
      tone,
      eyebrow,
      title: `${Math.max(0, transfer.gap)} min transfer at ${stop}`,
      detail: `Next: ${nextVehicle}${departure ? ` · around ${departure}` : ""}${untilDeparture <= 10 ? ` · departs in about ${Math.max(1, untilDeparture)} min` : ""}.${platformCopy} ${platformDrift ? "Allow a little extra attention for the changed boarding point." : tight ? "Keep the next leg in mind and be ready to change promptly." : "This is worth watching, but no action is needed yet."}`,
      gap: transfer.gap,
      gapMs: transfer.gapMs,
      stop,
      segmentIndex: transfer.index + 1,
      platformChanged: Boolean(platformDrift),
    };
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) && value >= 0 ? value : -1;
  }

  function focusedAssignment() {
    const list = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    const focus = focusIndex();
    return Array.isArray(list) && focus >= 0 ? list[focus] || null : null;
  }

  function focusedFreshEntry(now = Date.now()) {
    const focus = focusIndex();
    if (focus < 0) return null;
    const entry = window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
    if (!entry) return null;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness) return freshness.fresh ? entry : null;
    const at = Number(entry.at);
    if (!Number.isFinite(at)) return null;
    const age = now - at;
    return age >= -MAX_FUTURE_SKEW_MS && age <= STALE_AFTER_MS ? entry : null;
  }

  function blockingVoluntaryState(now = Date.now()) {
    const entry = focusedFreshEntry(now);
    return entry && BLOCKING_VOLUNTARY.has(entry.status) ? entry.status : null;
  }

  function freshMissed(now = Date.now()) {
    return blockingVoluntaryState(now) === "missed";
  }

  function ensureCard() {
    if (lifecycleFrozen) return null;
    let card = document.getElementById("v0111TransferWatch");
    if (card) return card;
    const personal = document.getElementById("personalSharedPlan");
    if (!personal) return null;
    card = document.createElement("aside");
    card.id = "v0111TransferWatch";
    card.className = "v0111-transfer-watch";
    card.setAttribute("role", "status");
    card.setAttribute("aria-live", "polite");
    const guidance = document.getElementById("v0111TripGuidance");
    if (guidance?.parentElement === personal) guidance.insertAdjacentElement("afterend", card);
    else {
      const steps = personal.querySelector?.(".personal-route-steps");
      if (steps) steps.insertAdjacentElement("beforebegin", card);
      else personal.appendChild(card);
    }
    return card;
  }

  function removeCard() {
    if (lifecycleFrozen) return;
    document.getElementById("v0111TransferWatch")?.remove?.();
    lastMarkup = "";
  }

  function render(now = Date.now()) {
    if (lifecycleFrozen || document.hidden) return null;
    if (!recommendationsActive) {
      removeCard();
      return null;
    }
    const assignment = focusedAssignment();
    if (!assignment?.route || blockingVoluntaryState(now)) {
      removeCard();
      return null;
    }
    const model = transferModel(assignment.route, now);
    if (!model) {
      removeCard();
      return null;
    }
    const card = ensureCard();
    if (!card) return model;
    card.dataset.tone = model.tone;
    const markup = `<span class="v0111-transfer-watch-icon" aria-hidden="true">⇄</span><div><small>${escapeHtml(model.eyebrow)}</small><strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.detail)}</p><em>Timetable/realtime route data · no location tracking</em></div>`;
    if (markup !== lastMarkup) {
      card.innerHTML = markup;
      lastMarkup = markup;
    }
    return model;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (lifecycleFrozen || document.hidden || !recommendationsActive) return;
    timer = setTimeout(() => {
      timer = null;
      if (lifecycleFrozen || document.hidden || !recommendationsActive) return;
      render();
      schedule();
    }, UPDATE_MS);
  }

  function refresh() {
    if (lifecycleFrozen || document.hidden) return;
    render();
    schedule();
  }

  function clearRecommendationState() {
    if (lifecycleFrozen) return;
    recommendationsActive = false;
    clearTimeout(timer);
    timer = null;
    removeCard();
  }

  function activateRecommendationState() {
    if (lifecycleFrozen) return;
    recommendationsActive = true;
    refresh();
  }

  function freezeLifecycle() {
    lifecycleFrozen = true;
    clearTimeout(timer);
    timer = null;
  }

  function resumeLifecycle() {
    lifecycleFrozen = false;
    recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments?.length);
    refresh();
  }

  ["load", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => window.addEventListener(name, refresh));
  window.addEventListener("nvs-group-recommendations-rendered", activateRecommendationState);
  window.addEventListener("nvs-recommendations-cleared", clearRecommendationState);
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", resumeLifecycle);
  document.addEventListener("visibilitychange", () => {
    if (lifecycleFrozen) return;
    if (document.hidden) {
      clearTimeout(timer);
      timer = null;
    } else refresh();
  });

  window.NVSTransferWatch0111 = Object.freeze({ transferGapMs, transferGapMinutes, transferCandidates, transferModel, platformChange, disruptionSummary, focusedFreshEntry, blockingVoluntaryState, freshMissed, render, refresh });
  refresh();
})();