(() => {
  const UPDATE_MS = 20_000;
  const MAX_WATCH_MIN = 6;
  let timer = null;
  let lastMarkup = "";

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

  function isWalk(segment) {
    return String(segment?.mode || "").toUpperCase() === "WALK";
  }

  function vehicleLabel(segment) {
    const instruction = window.NVSInstructions?.instructionFor?.(segment);
    if (instruction?.title) return String(instruction.title);
    const mode = String(segment?.modeLabel || segment?.mode || "Transit").trim();
    const line = String(segment?.line || "").trim();
    return line && !mode.toLowerCase().includes(line.toLowerCase()) ? `${mode} ${line}` : mode;
  }

  function transferGapMinutes(current, next) {
    const arrival = asDate(current?.arrival)?.getTime();
    const departure = asDate(next?.departure)?.getTime();
    if (!Number.isFinite(arrival) || !Number.isFinite(departure)) return null;
    return Math.round((departure - arrival) / 60_000);
  }

  function transferCandidates(route, now = Date.now()) {
    const segments = Array.isArray(route?.segments) ? route.segments.filter(Boolean) : [];
    const candidates = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
      const current = segments[index];
      const next = segments[index + 1];
      if (isWalk(current) || isWalk(next)) continue;
      const arrival = asDate(current.arrival);
      const departure = asDate(next.departure);
      if (!arrival || !departure || departure.getTime() < now - 60_000) continue;
      const gap = transferGapMinutes(current, next);
      if (gap == null || gap > MAX_WATCH_MIN) continue;
      candidates.push({ index, current, next, gap, arrival, departure });
    }
    return candidates.sort((a, b) => a.departure - b.departure);
  }

  function transferModel(route, now = Date.now()) {
    const transfer = transferCandidates(route, now)[0] || null;
    if (!transfer) return null;
    const stop = String(transfer.current?.to || transfer.next?.from || "your transfer stop");
    const nextVehicle = vehicleLabel(transfer.next);
    const platform = String(transfer.next?.platformFrom || "").trim();
    const departure = formatTime(transfer.next?.departure);
    if (transfer.gap < 0) {
      return {
        tone: "critical",
        eyebrow: "Connection protection",
        title: "This planned connection no longer fits",
        detail: `${nextVehicle} is due to leave ${stop} about ${Math.max(1, Math.abs(transfer.gap))} min before the previous leg arrives. Use Recovery Desk or replan instead of relying on this transfer.`,
        gap: transfer.gap,
        stop,
        segmentIndex: transfer.index + 1,
      };
    }
    const tight = transfer.gap <= 3;
    return {
      tone: tight ? "warn" : "info",
      eyebrow: tight ? "Connection protection · tight" : "Connection protection",
      title: `${Math.max(0, transfer.gap)} min transfer at ${stop}`,
      detail: `Next: ${nextVehicle}${platform ? ` · platform ${platform}` : ""}${departure ? ` · around ${departure}` : ""}. ${tight ? "Keep the next leg in mind and be ready to change promptly." : "This is worth watching, but no action is needed yet."}`,
      gap: transfer.gap,
      stop,
      segmentIndex: transfer.index + 1,
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

  function freshMissed(now = Date.now()) {
    const focus = focusIndex();
    if (focus < 0) return false;
    const entry = window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
    if (entry?.status !== "missed") return false;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness) return Boolean(freshness.fresh);
    const at = Number(entry.at);
    return Number.isFinite(at) && now >= at && now - at <= 15 * 60_000;
  }

  function ensureCard() {
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
    document.getElementById("v0111TransferWatch")?.remove?.();
    lastMarkup = "";
  }

  function render(now = Date.now()) {
    const assignment = focusedAssignment();
    if (!assignment?.route || freshMissed(now)) {
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
    if (document.hidden) return;
    timer = setTimeout(() => {
      render();
      schedule();
    }, UPDATE_MS);
  }

  function refresh() {
    render();
    schedule();
  }

  ["load", "pageshow", "nvs-group-recommendations-rendered", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => window.addEventListener(name, refresh));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });

  window.NVSTransferWatch0111 = Object.freeze({ transferGapMinutes, transferCandidates, transferModel, freshMissed, render, refresh });
  refresh();
})();
