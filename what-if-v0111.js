(() => {
  const DELAYS = [5, 10];
  let selectedIndex = 0;
  let selectedDelay = 5;
  let lastMarkup = "";
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

  function shiftDate(value, deltaMs) {
    const date = asDate(value);
    return date ? new Date(date.getTime() + deltaMs) : value;
  }

  function shiftStop(stop, deltaMs) {
    if (!stop || typeof stop === "string") return stop;
    return {
      ...stop,
      arrival: shiftDate(stop.arrival, deltaMs),
      departure: shiftDate(stop.departure, deltaMs),
    };
  }

  function shiftSegment(segment, deltaMs) {
    if (!segment || typeof segment !== "object") return segment;
    return {
      ...segment,
      departure: shiftDate(segment.departure, deltaMs),
      arrival: shiftDate(segment.arrival, deltaMs),
      intermediateStops: Array.isArray(segment.intermediateStops)
        ? segment.intermediateStops.map((stop) => shiftStop(stop, deltaMs))
        : segment.intermediateStops,
      geometry: Array.isArray(segment.geometry) ? segment.geometry.map((point) => Array.isArray(point) ? [...point] : point) : segment.geometry,
      remarks: Array.isArray(segment.remarks) ? [...segment.remarks] : segment.remarks,
    };
  }

  function shiftRoute(route, delayMinutes) {
    const deltaMs = Math.max(0, Number(delayMinutes) || 0) * 60_000;
    if (!route || !deltaMs) return route ? {
      ...route,
      segments: Array.isArray(route.segments) ? route.segments.map((segment) => shiftSegment(segment, 0)) : route.segments,
      geometry: Array.isArray(route.geometry) ? route.geometry.map((point) => Array.isArray(point) ? [...point] : point) : route.geometry,
    } : route;
    return {
      ...route,
      departure: shiftDate(route.departure, deltaMs),
      arrival: shiftDate(route.arrival, deltaMs),
      segments: Array.isArray(route.segments) ? route.segments.map((segment) => shiftSegment(segment, deltaMs)) : route.segments,
      geometry: Array.isArray(route.geometry) ? route.geometry.map((point) => Array.isArray(point) ? [...point] : point) : route.geometry,
    };
  }

  function assignments(group) {
    return Array.isArray(group?.assignments) ? group.assignments.filter((item) => item?.member && item?.route) : [];
  }

  function isFresh(entry, now) {
    if (!entry) return false;
    const freshness = window.NVSIntelligenceCore?.checkinFreshness?.(entry, new Date(now));
    if (freshness) return Boolean(freshness.fresh);
    const at = Number(entry.at);
    return Number.isFinite(at) && now >= at && now - at <= 15 * 60_000;
  }

  function recoveryActive(group, liveState, now = Date.now()) {
    const list = assignments(group);
    const members = liveState?.members && typeof liveState.members === "object" ? liveState.members : {};
    return list.some((_, index) => {
      const entry = members[String(index)];
      return entry?.status === "missed" && isFresh(entry, now);
    });
  }

  function meetupConfirmed(group, liveState, now = Date.now()) {
    const list = assignments(group);
    if (list.length < 2) return false;
    const members = liveState?.members && typeof liveState.members === "object" ? liveState.members : {};
    return list.every((_, index) => {
      const entry = members[String(index)];
      return entry?.status === "arrived" && isFresh(entry, now);
    });
  }

  function recomputeLatestArrival(list) {
    const times = list.map((item) => asDate(item.route?.arrival)).filter(Boolean);
    return times.length ? new Date(Math.max(...times.map((date) => date.getTime()))) : null;
  }

  function delayedGroup(group, memberIndex, delayMinutes) {
    const list = assignments(group);
    if (list.length < 2 || memberIndex < 0 || memberIndex >= list.length) return null;
    const clonedAssignments = list.map((item, index) => ({
      ...item,
      member: { ...item.member },
      route: shiftRoute(item.route, index === memberIndex ? delayMinutes : 0),
    }));
    return {
      ...group,
      assignments: clonedAssignments,
      latestArrival: recomputeLatestArrival(clonedAssignments) || group.latestArrival,
    };
  }

  function nextEvent(analysis, now) {
    return (Array.isArray(analysis?.events) ? analysis.events : [])
      .filter((event) => asDate(event?.time)?.getTime() >= now - 30_000)
      .sort((a, b) => asDate(a.time) - asDate(b.time))[0] || null;
  }

  function arrivalSpread(group) {
    const times = assignments(group).map((item) => asDate(item.route?.arrival)?.getTime()).filter(Number.isFinite).sort((a, b) => a - b);
    return times.length > 1 ? Math.max(0, Math.round((times[times.length - 1] - times[0]) / 60_000)) : 0;
  }

  function eventSignature(event) {
    if (!event) return "none";
    return [event.kind || "", event.final ? "final" : "", String(event.label || event.name || ""), [...(event.memberIds || [])].sort().join(",")].join("|");
  }

  function simulate(group, memberIndex, delayMinutes, now = Date.now()) {
    const baseAssignments = assignments(group);
    if (baseAssignments.length < 2) return null;
    const index = Math.max(0, Math.min(baseAssignments.length - 1, Number(memberIndex) || 0));
    const delay = DELAYS.includes(Number(delayMinutes)) ? Number(delayMinutes) : 5;
    const hypothetical = delayedGroup(group, index, delay);
    if (!hypothetical) return null;
    const analyze = window.NVSConvergence?.analyze;
    if (typeof analyze !== "function") return null;
    const options = { destinationLabel: group?.destination || "Meetup" };
    const baseAnalysis = analyze(group, options);
    const delayedAnalysis = analyze(hypothetical, options);
    const before = nextEvent(baseAnalysis, now);
    const after = nextEvent(delayedAnalysis, now);
    const beforeSpread = arrivalSpread(group);
    const afterSpread = arrivalSpread(hypothetical);
    const member = baseAssignments[index].member;
    const sameNextJoin = eventSignature(before) === eventSignature(after);
    const beforeTime = asDate(before?.time);
    const afterTime = asDate(after?.time);
    const joinShift = beforeTime && afterTime && sameNextJoin ? Math.round((afterTime - beforeTime) / 60_000) : null;

    let tone = "info";
    let title = `${String(member?.name || "Person")} +${delay} min`;
    let detail = "This local preview does not change or share the real meetup plan.";
    if (before && !after) {
      tone = "warn";
      detail = "The currently detected upcoming join disappears in this timing stress test. The group may need a different recovery point.";
    } else if (before && after && !sameNextJoin) {
      tone = "warn";
      detail = `The next detected convergence changes from ${String(before.label || before.name || "the planned join")} to ${String(after.label || after.name || "a later join")}${afterTime ? ` around ${formatTime(afterTime)}` : ""}.`;
    } else if (after?.final) {
      tone = afterSpread > beforeSpread ? "action" : "good";
      detail = `Everyone would still converge at the destination${afterTime ? ` around ${formatTime(afterTime)}` : ""}. Planned arrival spread becomes ${afterSpread} min${afterSpread === beforeSpread ? " (unchanged)" : `, from ${beforeSpread} min`}.`;
    } else if (after) {
      tone = joinShift && joinShift > 3 ? "action" : "good";
      detail = `The same next join still appears at ${String(after.label || after.name || "the planned meetup point")}${afterTime ? ` around ${formatTime(afterTime)}` : ""}${joinShift ? ` (${joinShift > 0 ? "+" : ""}${joinShift} min)` : ""}. Planned arrival spread: ${afterSpread} min.`;
    }

    return {
      tone,
      title,
      detail,
      memberIndex: index,
      memberName: String(member?.name || "Person"),
      delay,
      beforeSpread,
      afterSpread,
      beforeEvent: before,
      afterEvent: after,
      sameNextJoin,
      localOnly: true,
      hypothetical,
    };
  }

  function ensureCard() {
    if (lifecycleFrozen) return null;
    let card = document.getElementById("v0111WhatIf");
    if (card) return card;
    const radar = document.getElementById("v0111MeetupRadar");
    const command = document.getElementById("v011CommandCenter");
    const anchor = radar || command;
    if (!anchor) return null;
    card = document.createElement("details");
    card.id = "v0111WhatIf";
    card.className = "v0111-what-if";
    anchor.insertAdjacentElement("afterend", card);
    return card;
  }

  function renderStateCard(card, tone, small, title, detail, footer) {
    if (lifecycleFrozen || !card) return;
    card.dataset.tone = tone;
    const markup = `<summary><span aria-hidden="true">◇</span><strong>What if?</strong><small>${escapeHtml(small)}</small></summary><div class="v0111-what-if-body"><div class="v0111-what-if-result" role="status"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p><small>${escapeHtml(footer)}</small></div></div>`;
    if (markup !== lastMarkup) {
      const wasOpen = card.open;
      card.innerHTML = markup;
      card.open = wasOpen;
      lastMarkup = markup;
    }
  }

  function render(now = Date.now()) {
    if (lifecycleFrozen) return null;
    const group = window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
    const list = assignments(group);
    if (list.length < 2 || typeof window.NVSConvergence?.analyze !== "function") {
      document.getElementById("v0111WhatIf")?.remove?.();
      lastMarkup = "";
      return null;
    }
    const liveState = window.NVSSharedLive?.getState?.() || null;
    const card = ensureCard();
    if (recoveryActive(group, liveState, now)) {
      renderStateCard(card, "warn", "Paused for recovery", "Recovery takes priority", "A fresh missed-connection report means the current plan may no longer be a useful baseline. Replan or resolve recovery before comparing hypothetical delays.", "Simulation paused · voluntary report takes precedence · no GPS");
      return { paused: true, reason: "recovery" };
    }
    if (meetupConfirmed(group, liveState, now)) {
      renderStateCard(card, "good", "Meetup complete", "Everyone confirmed here", "The meetup is already complete, so delay simulations are paused until those voluntary arrival confirmations become stale or are cleared.", "Simulation paused · confirmed arrival takes precedence · no GPS");
      return { paused: true, reason: "complete" };
    }
    if (selectedIndex >= list.length) selectedIndex = 0;
    const model = simulate(group, selectedIndex, selectedDelay, now);
    if (!model) return null;
    if (!card) return model;
    card.dataset.tone = model.tone;
    const memberOptions = list.map((item, index) => `<option value="${index}"${index === selectedIndex ? " selected" : ""}>${escapeHtml(item.member?.name || `Person ${index + 1}`)}</option>`).join("");
    const delayButtons = DELAYS.map((delay) => `<button type="button" data-what-if-delay="${delay}" aria-pressed="${delay === selectedDelay ? "true" : "false"}">+${delay} min</button>`).join("");
    const markup = `<summary><span aria-hidden="true">◇</span><strong>What if?</strong><small>Local timing preview</small></summary><div class="v0111-what-if-body"><p class="v0111-what-if-note">Stress-test the existing timetable by shifting one person's planned timing. This does not fetch an alternative route and does not change, save, or share the real meetup plan.</p><div class="v0111-what-if-controls"><label>Person<select data-what-if-member>${memberOptions}</select></label><div class="v0111-what-if-delays" aria-label="Hypothetical delay">${delayButtons}</div></div><div class="v0111-what-if-result" role="status" aria-live="polite"><strong>${escapeHtml(model.title)}</strong><p>${escapeHtml(model.detail)}</p><small>Simulation only · existing timetable/convergence data · no GPS</small></div></div>`;
    if (markup !== lastMarkup) {
      const wasOpen = card.open;
      card.innerHTML = markup;
      card.open = wasOpen;
      lastMarkup = markup;
    }
    return model;
  }

  function freezeLifecycle() {
    lifecycleFrozen = true;
  }

  function resumeLifecycle() {
    lifecycleFrozen = false;
    lastMarkup = "";
    render();
  }

  document.addEventListener("change", (event) => {
    if (lifecycleFrozen) return;
    const select = event.target?.closest?.("[data-what-if-member]");
    if (!select) return;
    selectedIndex = Math.max(0, Number(select.value) || 0);
    lastMarkup = "";
    render();
  });

  document.addEventListener("click", (event) => {
    if (lifecycleFrozen) return;
    const button = event.target?.closest?.("[data-what-if-delay]");
    if (!button) return;
    const delay = Number(button.dataset.whatIfDelay);
    if (!DELAYS.includes(delay)) return;
    selectedDelay = delay;
    lastMarkup = "";
    render();
  });

  ["load", "nvs-group-recommendations-rendered", "nvs-recommendations-cleared", "nvs-shared-live-change", "nvs-live-plan-synced", "nvs-group-change", "nvs-timing-change", "nvs-shared-view-resumed"].forEach((name) => window.addEventListener(name, () => render()));
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", resumeLifecycle);

  window.NVSWhatIf0111 = Object.freeze({ simulate, delayedGroup, shiftRoute, recoveryActive, meetupConfirmed, render });
  render();
})();