(() => {
  if (!window.NVSTestLab?.active || window.NVSTestJourney?.active) return;

  const STATUSES = ["timetable", "left", "on-vehicle", "at-stop", "missed", "arrived"];
  const DELAYS = [0, 3, 5, 10, 20, 30, 60];
  const overrides = new Map();
  const baselines = new Map();
  const delayOverrides = new Map();
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
    window.dispatchEvent(new Event("nvs-group-recommendations-rendered"));
    window.dispatchEvent(new Event("nvs-timing-change"));
  }

  function applyRouteDelays() {
    if (applyingRoutes) return false;
    const list = assignments();
    if (!list.length || !delayOverrides.size) return false;
    applyingRoutes = true;
    try {
      delayOverrides.forEach((minutes, index) => {
        const assignment = list[index];
        if (!assignment?.route) return;
        const baseline = rememberRouteBaseline(index, assignment);
        if (!baseline) return;
        const applied = shiftedRoute(baseline.route, minutes);
        baseline.applied = applied;
        assignment.route = applied;
      });
      emitRouteChange();
      return true;
    } finally { applyingRoutes = false; }
  }

  function clearRouteDelay(index) {
    const memberIndex = Number(index);
    const list = assignments();
    if (!Number.isInteger(memberIndex) || memberIndex < 0) return false;
    const assignment = list[memberIndex];
    const baseline = routeBaselines.get(memberIndex);
    if (assignment && baseline && assignment.route === baseline.applied) assignment.route = baseline.route;
    delayOverrides.delete(memberIndex);
    routeBaselines.delete(memberIndex);
    emitRouteChange();
    render();
    return true;
  }

  function setRouteDelay(index, minutes) {
    const memberIndex = Number(index);
    const amount = Number(minutes);
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !DELAYS.includes(amount) || !assignments()[memberIndex]?.route) return false;
    if (amount === 0) return clearRouteDelay(memberIndex);
    delayOverrides.set(memberIndex, amount);
    const result = applyRouteDelays();
    render();
    return result;
  }

  function resetRouteDelays() {
    [...delayOverrides.keys()].forEach((index) => clearRouteDelay(index));
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
    if (memberRoot) memberRoot.innerHTML = members.map((assignment, index) => `<div class="nvs-test-row"><label class="nvs-test-field"><span>${esc(assignment.member?.name || `Person ${index + 1}`)} state</span><select data-test-member="${index}" ${liveState()?.members ? "" : "disabled"}>${STATUSES.map((status) => `<option value="${status}" ${overrides.get(index) === status || (!overrides.has(index) && status === "timetable") ? "selected" : ""}>${status === "timetable" ? "Real/timetable" : esc(status)}</option>`).join("")}</select></label><label class="nvs-test-field"><span>${esc(assignment.member?.name || `Person ${index + 1}`)} delay</span><select data-test-delay="${index}">${DELAYS.map((minutes) => `<option value="${minutes}" ${delayOverrides.get(index) === minutes || (!delayOverrides.has(index) && minutes === 0) ? "selected" : ""}>${minutes === 0 ? "Real timing" : `+${minutes} min`}</option>`).join("")}</select></label></div>`).join("");

    const note = section.querySelector("#nvsTestJourneyNote");
    if (note) note.textContent = liveState()?.members ? "Member states and route delays are memory-only overlays. Incoming read-only Shared Live and route data remain the baseline underneath them." : "Route-delay simulation works on loaded routes. Member-state simulation unlocks after a shared session has loaded read-only live state.";
  }

  window.addEventListener("nvs-shared-live-change", () => {
    if (applying) return;
    baselines.clear();
    if (overrides.size) queueMicrotask(applyOverrides);
    queueMicrotask(render);
  });
  window.addEventListener("nvs-group-recommendations-rendered", () => {
    if (applyingRoutes) return;
    if (delayOverrides.size) queueMicrotask(applyRouteDelays);
    queueMicrotask(render);
  });
  window.addEventListener("nvs-test-state-change", (event) => {
    if (event.detail?.reason === "reset") {
      resetMembers();
      resetRouteDelays();
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
    getOverrides: () => Object.fromEntries(overrides),
    getRouteDelays: () => Object.fromEntries(delayOverrides),
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true }); else render();
})();
