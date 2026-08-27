(() => {
  if (!window.NVSTestLab?.active || window.NVSTestJourney?.active) return;

  const STATUSES = ["timetable", "left", "on-vehicle", "at-stop", "missed", "arrived"];
  const DELAYS = [0, 3, 5, 10, 20, 30, 60];
  const DISRUPTIONS = ["real", "platform-change", "cancelled", "delay-5", "delay-10"];
  const overrides = new Map();
  const baselines = new Map();
  const delayOverrides = new Map();
  const disruptionOverrides = new Map();
  const routeBaselines = new Map();
  let applying = false;
  let applyingRoutes = false;

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const recommendation = () => window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
  const assignments = () => {
    const list = recommendation()?.assignments;
    return Array.isArray(list) ? list.filter((item) => item?.member && item?.route) : [];
  };
  const liveState = () => window.NVSSharedLive?.getState?.() || null;
  const asTime = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : NaN;
  };

  function collectEvents() {
    const found = [];
    assignments().forEach((assignment, memberIndex) => {
      const person = `Person ${memberIndex + 1}`;
      const route = assignment.route || {};
      const add = (value, label, kind) => {
        const time = asTime(value);
        if (Number.isFinite(time)) found.push({ time, label: `${person} · ${label}`, kind, memberIndex });
      };
      add(route.departure, "depart", "departure");
      (Array.isArray(route.segments) ? route.segments : []).forEach((segment, index) => {
        if (index > 0) add(segment?.departure, `transfer ${index}`, "transfer");
      });
      add(route.arrival, "arrive", "arrival");
    });
    const group = recommendation();
    if (group && window.NVSConvergence?.analyze) {
      try {
        const analysis = window.NVSConvergence.analyze(group, { destinationLabel: "Meetup" });
        (analysis?.events || []).forEach((event) => {
          const time = asTime(event?.time);
          if (Number.isFinite(time)) found.push({ time, label: `★ ${String(event.title || event.label || "join")}`, kind: "join", memberIndex: -1 });
        });
      } catch {}
    }
    const seen = new Set();
    return found.sort((a, b) => a.time - b.time).filter((event) => {
      const key = `${event.time}:${event.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 24);
  }

  function jumpToEvent(index) {
    const event = collectEvents()[Number(index)];
    return event ? window.NVSTestLab.setNow(event.time) : false;
  }

  function rememberBaseline(index, state = liveState()) {
    if (!state?.members || baselines.has(index)) return;
    const current = state.members[String(index)];
    baselines.set(index, current ? { ...current } : null);
  }

  function applyOverrides() {
    const state = liveState();
    if (!state?.members || applying) return false;
    applying = true;
    try {
      overrides.forEach((status, index) => {
        rememberBaseline(index, state);
        state.members[String(index)] = { status, note: "Test Lab simulation", at: Date.now(), simulated: true };
      });
      window.dispatchEvent(new CustomEvent("nvs-test-member-state-change", { detail: { count: overrides.size } }));
      window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: state }));
      window.dispatchEvent(new Event("nvs-group-recommendations-rendered"));
      return true;
    } finally { applying = false; }
  }

  function clearMemberStatus(index) {
    const memberIndex = Number(index);
    const state = liveState();
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !state?.members) return false;
    const baseline = baselines.get(memberIndex);
    if (baseline) state.members[String(memberIndex)] = { ...baseline };
    else delete state.members[String(memberIndex)];
    overrides.delete(memberIndex);
    baselines.delete(memberIndex);
    window.dispatchEvent(new CustomEvent("nvs-test-member-state-change", { detail: { count: overrides.size } }));
    window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: state }));
    window.dispatchEvent(new Event("nvs-group-recommendations-rendered"));
    render();
    return true;
  }

  function setMemberStatus(index, status) {
    const memberIndex = Number(index);
    const next = String(status || "timetable");
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !STATUSES.includes(next) || !liveState()?.members) return false;
    rememberBaseline(memberIndex);
    if (next === "timetable") return clearMemberStatus(memberIndex);
    overrides.set(memberIndex, next);
    const result = applyOverrides();
    render();
    return result;
  }

  function resetMembers() {
    [...overrides.keys()].forEach((index) => clearMemberStatus(index));
  }

  function cloneValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    return value;
  }

  function shiftTemporal(value, minutes) {
    const delta = minutes * 60_000;
    if (value instanceof Date) return new Date(value.getTime() + delta);
    if (typeof value === "number" && Number.isFinite(value)) return value + delta;
    if (typeof value === "string" && value) {
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? new Date(time + delta).toISOString() : value;
    }
    return value;
  }

  function shiftedRoute(route, minutes) {
    const copy = cloneValue(route || {});
    copy.departure = shiftTemporal(copy.departure, minutes);
    copy.arrival = shiftTemporal(copy.arrival, minutes);
    if (Array.isArray(copy.segments)) {
      copy.segments = copy.segments.map((segment) => {
        const next = { ...segment };
        next.departure = shiftTemporal(next.departure, minutes);
        next.arrival = shiftTemporal(next.arrival, minutes);
        if (Array.isArray(next.intermediateStops)) {
          next.intermediateStops = next.intermediateStops.map((stop) => ({
            ...stop,
            arrival: shiftTemporal(stop?.arrival, minutes),
            departure: shiftTemporal(stop?.departure, minutes),
          }));
        }
        return next;
      });
    }
    copy.testLabDelayMinutes = minutes;
    copy.testLabSimulated = true;
    return copy;
  }

  function disruptionKey(memberIndex, segmentIndex) {
    return `${memberIndex}:${segmentIndex}`;
  }

  function memberHasRouteOverlay(index) {
    if (delayOverrides.has(index)) return true;
    const prefix = `${index}:`;
    return [...disruptionOverrides.keys()].some((key) => key.startsWith(prefix));
  }

  function firstTransitSegment(index, preferTransfer = false) {
    const segments = assignments()[Number(index)]?.route?.segments;
    if (!Array.isArray(segments)) return -1;
    const start = preferTransfer ? 1 : 0;
    for (let i = start; i < segments.length; i += 1) {
      if (String(segments[i]?.mode || "").toUpperCase() !== "WALK") return i;
    }
    if (preferTransfer) {
      for (let i = 0; i < Math.min(1, segments.length); i += 1) {
        if (String(segments[i]?.mode || "").toUpperCase() !== "WALK") return i;
      }
    }
    return -1;
  }

  function shiftSegmentRealtime(route, segmentIndex, minutes) {
    const segment = route?.segments?.[segmentIndex];
    if (!segment) return false;
    segment.departure = shiftTemporal(segment.departure, minutes);
    segment.arrival = shiftTemporal(segment.arrival, minutes);
    if (Array.isArray(segment.intermediateStops)) {
      segment.intermediateStops = segment.intermediateStops.map((stop) => ({
        ...stop,
        arrival: shiftTemporal(stop?.arrival, minutes),
        departure: shiftTemporal(stop?.departure, minutes),
      }));
    }
    if (segmentIndex === 0) route.departure = shiftTemporal(route.departure, minutes);
    if (segmentIndex === route.segments.length - 1) route.arrival = shiftTemporal(route.arrival, minutes);
    return true;
  }

  function applyDisruption(route, memberIndex, segmentIndex, kind) {
    const segment = route?.segments?.[segmentIndex];
    if (!segment) return false;
    if (kind === "platform-change") {
      const planned = String(segment.plannedPlatformFrom || segment.platformFrom || "1").trim() || "1";
      segment.plannedPlatformFrom = planned;
      segment.platformFrom = planned === "TEST" ? "ALT" : "TEST";
      segment.testLabDisruption = "platform-change";
      return true;
    }
    if (kind === "cancelled") {
      segment.cancelled = true;
      segment.isCancelled = true;
      segment.testLabDisruption = "cancelled";
      return true;
    }
    if (kind === "delay-5" || kind === "delay-10") {
      const minutes = kind === "delay-10" ? 10 : 5;
      if (!shiftSegmentRealtime(route, segmentIndex, minutes)) return false;
      segment.departureDelay = minutes;
      segment.arrivalDelay = minutes;
      segment.testLabDisruption = kind;
      return true;
    }
    return false;
  }

  function rememberRouteBaseline(index, assignment) {
    const current = assignment?.route;
    if (!current) return null;
    const existing = routeBaselines.get(index);
    if (existing?.applied === current) return existing;
    const baseline = { route: current, applied: null };
    routeBaselines.set(index, baseline);
    return baseline;
  }

  function emitRouteChange() {
    window.dispatchEvent(new CustomEvent("nvs-test-route-delay-change", {
      detail: { count: delayOverrides.size, delays: Object.fromEntries(delayOverrides) },
    }));
    window.dispatchEvent(new CustomEvent("nvs-test-route-disruption-change", {
      detail: { count: disruptionOverrides.size, disruptions: Object.fromEntries(disruptionOverrides) },
    }));
    window.dispatchEvent(new Event("nvs-group-recommendations-rendered"));
    window.dispatchEvent(new Event("nvs-timing-change"));
  }

  function applyRouteOverlays() {
    if (applyingRoutes) return false;
    const list = assignments();
    if (!list.length || (!delayOverrides.size && !disruptionOverrides.size)) return false;
    applyingRoutes = true;
    let changed = false;
    try {
      list.forEach((assignment, index) => {
        if (!assignment?.route || !memberHasRouteOverlay(index)) return;
        const baseline = rememberRouteBaseline(index, assignment);
        if (!baseline) return;
        const delay = delayOverrides.get(index) || 0;
        const applied = delay ? shiftedRoute(baseline.route, delay) : cloneValue(baseline.route);
        const prefix = `${index}:`;
        disruptionOverrides.forEach((kind, key) => {
          if (!key.startsWith(prefix)) return;
          const segmentIndex = Number(key.slice(prefix.length));
          applyDisruption(applied, index, segmentIndex, kind);
        });
        applied.testLabSimulated = true;
        baseline.applied = applied;
        assignment.route = applied;
        changed = true;
      });
      if (changed) emitRouteChange();
      return changed;
    } finally { applyingRoutes = false; }
  }

  function restoreRouteIfClear(index) {
    if (memberHasRouteOverlay(index)) return;
    const assignment = assignments()[index];
    const baseline = routeBaselines.get(index);
    if (assignment && baseline && assignment.route === baseline.applied) assignment.route = baseline.route;
    routeBaselines.delete(index);
  }

  function clearRouteDelay(index) {
    const memberIndex = Number(index);
    if (!Number.isInteger(memberIndex) || memberIndex < 0) return false;
    delayOverrides.delete(memberIndex);
    restoreRouteIfClear(memberIndex);
    if (memberHasRouteOverlay(memberIndex)) applyRouteOverlays(); else emitRouteChange();
    render();
    return true;
  }

  function setRouteDelay(index, minutes) {
    const memberIndex = Number(index);
    const amount = Number(minutes);
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !DELAYS.includes(amount) || !assignments()[memberIndex]?.route) return false;
    if (amount === 0) return clearRouteDelay(memberIndex);
    delayOverrides.set(memberIndex, amount);
    const result = applyRouteOverlays();
    render();
    return result;
  }

  function resetRouteDelays() {
    [...delayOverrides.keys()].forEach((index) => clearRouteDelay(index));
  }

  function setSegmentDisruption(index, segmentIndex, kind) {
    const memberIndex = Number(index);
    const legIndex = Number(segmentIndex);
    const next = String(kind || "real");
    const route = assignments()[memberIndex]?.route;
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !Number.isInteger(legIndex) || legIndex < 0 || !DISRUPTIONS.includes(next) || !route?.segments?.[legIndex]) return false;
    const key = disruptionKey(memberIndex, legIndex);
    if (next === "real") return clearSegmentDisruption(memberIndex, legIndex);
    disruptionOverrides.set(key, next);
    const result = applyRouteOverlays();
    render();
    return result;
  }

  function clearSegmentDisruption(index, segmentIndex) {
    const memberIndex = Number(index);
    const legIndex = Number(segmentIndex);
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !Number.isInteger(legIndex) || legIndex < 0) return false;
    disruptionOverrides.delete(disruptionKey(memberIndex, legIndex));
    restoreRouteIfClear(memberIndex);
    if (memberHasRouteOverlay(memberIndex)) applyRouteOverlays(); else emitRouteChange();
    render();
    return true;
  }

  function resetDisruptions() {
    const members = new Set([...disruptionOverrides.keys()].map((key) => Number(key.split(":")[0])));
    disruptionOverrides.clear();
    members.forEach((index) => {
      restoreRouteIfClear(index);
      if (memberHasRouteOverlay(index)) applyRouteOverlays();
    });
    emitRouteChange();
    render();
  }

  function ensureUi() {
    const body = document.querySelector("#nvsTestLab .nvs-test-body");
    if (!body) return null;
    let section = document.getElementById("nvsTestJourney");
    if (section) return section;
    section = document.createElement("section");
    section.id = "nvsTestJourney";
    section.innerHTML = `<div class="nvs-test-diagnostics"><strong>Journey simulator</strong><span>Local overlay only · never shared</span></div><div id="nvsTestJourneyEvents" class="nvs-test-actions"></div><div id="nvsTestJourneyMembers"></div><p id="nvsTestJourneyNote" class="nvs-test-note"></p>`;
    const reset = body.querySelector("#nvsTestRealTime");
    if (reset) reset.insertAdjacentElement("beforebegin", section); else body.appendChild(section);
    section.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-test-event]");
      if (button) jumpToEvent(button.dataset.testEvent);
    });
    section.addEventListener("change", (event) => {
      const select = event.target.closest?.("[data-test-member]");
      if (select) setMemberStatus(select.dataset.testMember, select.value);
      const delay = event.target.closest?.("[data-test-delay]");
      if (delay) setRouteDelay(delay.dataset.testDelay, delay.value);
      const disruption = event.target.closest?.("[data-test-disruption]");
      if (disruption) setSegmentDisruption(disruption.dataset.testDisruption, disruption.dataset.testSegment, disruption.value);
    });
    return section;
  }

  function render() {
    if (!document.body) return;
    const section = ensureUi();
    if (!section) return;
    const events = collectEvents();
    const eventRoot = section.querySelector("#nvsTestJourneyEvents");
    if (eventRoot) eventRoot.innerHTML = events.length ? events.map((event, index) => `<button type="button" data-test-event="${index}" title="Jump simulated time"><span>${esc(event.label)}</span><small>${esc(new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.time)))}</small></button>`).join("") : `<span class="nvs-test-note">Find a route to create jump points.</span>`;

    const memberRoot = section.querySelector("#nvsTestJourneyMembers");
    const members = assignments();
    if (memberRoot) memberRoot.innerHTML = members.map((assignment, index) => {
      const name = esc(assignment.member?.name || `Person ${index + 1}`);
      const target = firstTransitSegment(index, true);
      const disruption = target >= 0 ? (disruptionOverrides.get(disruptionKey(index, target)) || "real") : "real";
      return `<div class="nvs-test-row"><label class="nvs-test-field"><span>${name} state</span><select data-test-member="${index}" ${liveState()?.members ? "" : "disabled"}>${STATUSES.map((status) => `<option value="${status}" ${overrides.get(index) === status || (!overrides.has(index) && status === "timetable") ? "selected" : ""}>${status === "timetable" ? "Real/timetable" : esc(status)}</option>`).join("")}</select></label><label class="nvs-test-field"><span>${name} delay</span><select data-test-delay="${index}">${DELAYS.map((minutes) => `<option value="${minutes}" ${delayOverrides.get(index) === minutes || (!delayOverrides.has(index) && minutes === 0) ? "selected" : ""}>${minutes === 0 ? "Real timing" : `+${minutes} min`}</option>`).join("")}</select></label><label class="nvs-test-field"><span>${name} next transit leg</span><select data-test-disruption="${index}" data-test-segment="${target}" ${target < 0 ? "disabled" : ""}>${DISRUPTIONS.map((kind) => `<option value="${kind}" ${disruption === kind ? "selected" : ""}>${kind === "real" ? "Real realtime" : kind === "platform-change" ? "Platform change → TEST" : kind === "cancelled" ? "Cancelled" : kind === "delay-10" ? "+10 min realtime" : "+5 min realtime"}</option>`).join("")}</select></label></div>`;
    }).join("");

    const note = section.querySelector("#nvsTestJourneyNote");
    if (note) note.textContent = liveState()?.members ? "Member state, timing and disruption overlays are memory-only. Incoming read-only Shared Live and fresh provider routes remain the baseline underneath them." : "Route timing/disruption simulation works on loaded routes. Member-state simulation unlocks after a shared session has loaded read-only live state.";
  }

  window.addEventListener("nvs-shared-live-change", () => {
    if (applying) return;
    baselines.clear();
    if (overrides.size) queueMicrotask(applyOverrides);
    queueMicrotask(render);
  });
  window.addEventListener("nvs-group-recommendations-rendered", () => {
    if (applyingRoutes) return;
    if (delayOverrides.size || disruptionOverrides.size) queueMicrotask(applyRouteOverlays);
    queueMicrotask(render);
  });
  window.addEventListener("nvs-test-state-change", (event) => {
    if (event.detail?.reason === "reset") {
      resetMembers();
      resetRouteDelays();
      resetDisruptions();
    }
    render();
  });
  window.addEventListener("load", render);

  window.NVSTestJourney = Object.freeze({
    active: true,
    collectEvents,
    jumpToEvent,
    setMemberStatus,
    clearMemberStatus,
    resetMembers,
    setRouteDelay,
    clearRouteDelay,
    resetRouteDelays,
    setSegmentDisruption,
    clearSegmentDisruption,
    resetDisruptions,
    firstTransitSegment,
    getOverrides: () => Object.fromEntries(overrides),
    getRouteDelays: () => Object.fromEntries(delayOverrides),
    getDisruptions: () => Object.fromEntries(disruptionOverrides),
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true }); else render();
})();