(() => {
  if (!window.NVSTestLab?.active || window.NVSTestJourney?.active) return;

  const STATUS_OPTIONS = ["timetable", "left", "on-vehicle", "at-stop", "missed", "arrived"];
  const overrides = new Map();
  const baselines = new Map();
  let applying = false;

  function recommendation() { return window.__NVS_LAST_RECOMMENDATIONS__?.primary || null; }
  function assignments() {
    const list = recommendation()?.assignments;
    return Array.isArray(list) ? list.filter((item) => item?.member && item?.route) : [];
  }
  function asTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();
    return Number.isFinite(time) ? time : NaN;
  }
  function collectEvents() {
    const found = [];
    assignments().forEach((assignment, memberIndex) => {
      const name = String(assignment.member?.name || `Person ${memberIndex + 1}`);
      const route = assignment.route || {};
      const add = (value, label, kind) => {
        const time = asTime(value);
        if (Number.isFinite(time)) found.push({ time, label: `${name} · ${label}`, kind, memberIndex });
      };
      add(route.departure, "depart", "departure");
      const segments = Array.isArray(route.segments) ? route.segments : [];
      segments.forEach((segment, index) => {
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
    if (!event) return false;
    return window.NVSTestLab.setNow(event.time);
  }
  function liveState() { return window.NVSSharedLive?.getState?.() || null; }
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
        state.members[String(index)] = {
          status,
          note: "Test Lab simulation",
          at: Date.now(),
          simulated: true,
        };
      });
      window.dispatchEvent(new CustomEvent("nvs-test-member-state-change", { detail: { count: overrides.size } }));
      window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: state }));
      window.dispatchEvent(new Event("nvs-group-recommendations-rendered"));
      return true;
    } finally { applying = false; }
  }
  function setMemberStatus(index, status) {
    const memberIndex = Number(index);
    const next = String(status || "timetable");
    if (!Number.isInteger(memberIndex) || memberIndex < 0 || !STATUS_OPTIONS.includes(next)) return false;
    if (!liveState()?.members) return false;
    rememberBaseline(memberIndex);
    if (next === "timetable") return clearMemberStatus(memberIndex);
    overrides.set(memberIndex, next);
    const result = applyOverrides();
    render();
    return result;
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
  function resetMembers() {
    [...overrides.keys()].forEach((index) => clearMemberStatus(index));
  }
  function ensureUi() {
    const body = document.querySelector("#nvsTestLab .nvs-test-body");
    if (!body) return null;
    let section = document.getElementById("nvsTestJourney");
    if (section) return section;
    section = document.createElement("section");
    section.id = "nvsTestJourney";
    section.className = "nvs-test-journey";
    section.innerHTML = `<div class="nvs-test-section-head"><strong>Journey simulator</strong><small>local overlay only</small></div><div id="nvsTestJourneyEvents" class="nvs-test-events"></div><div id="nvsTestJourneyMembers" class="nvs-test-members"></div><p id="nvsTestJourneyNote" class="nvs-test-note"></p>`;
    const reset = body.querySelector("#nvsTestRealTime");
    if (reset) reset.insertAdjacentElement("beforebegin", section); else body.appendChild(section);
    section.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-test-event]");
      if (button) jumpToEvent(button.dataset.testEvent);
    });
    section.addEventListener("change", (event) => {
      const select = event.target.closest?.("[data-test-member]");
      if (select) setMemberStatus(select.dataset.testMember, select.value);
    });
    return section;
  }
  function render() {
    if (!document.body) return;
    const section = ensureUi();
    if (!section) return;
    const events = collectEvents();
    const eventRoot = section.querySelector("#nvsTestJourneyEvents");
    if (eventRoot) eventRoot.innerHTML = events.length ? events.map((event, index) => `<button type="button" data-test-event="${index}"><span>${event.label}</span><small>${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.time))}</small></button>`).join("") : `<span class="nvs-test-empty">Find a route to create jump points.</span>`;
    const members = assignments();
    const memberRoot = section.querySelector("#nvsTestJourneyMembers");
    if (memberRoot) memberRoot.innerHTML = members.length ? members.map((assignment, index) => `<label><span>${String(assignment.member?.name || `Person ${index + 1}`)}</span><select data-test-member="${index}" ${liveState()?.members ? "" : "disabled"}>${STATUS_OPTIONS.map((status) => `<option value="${status}" ${overrides.get(index) === status || (!overrides.has(index) && status === "timetable") ? "selected" : ""}>${status === "timetable" ? "Real/timetable" : status}</option>`).join("")}</select></label>`).join("") : "";
    const note = section.querySelector("#nvsTestJourneyNote");
    if (note) note.textContent = liveState()?.members ? "Simulated member states stay in this tab and are never posted. Incoming read-only Shared Live data remains the baseline." : "Member-state simulation becomes available after a shared session has loaded read-only live state.";
  }

  window.addEventListener("nvs-shared-live-change", () => {
    if (applying) return;
    baselines.clear();
    if (overrides.size) queueMicrotask(applyOverrides);
    queueMicrotask(render);
  });
  window.addEventListener("nvs-group-recommendations-rendered", render);
  window.addEventListener("nvs-test-state-change", (event) => { if (event.detail?.reason === "reset") resetMembers(); render(); });
  window.addEventListener("load", render);

  window.NVSTestJourney = Object.freeze({ active: true, collectEvents, jumpToEvent, setMemberStatus, clearMemberStatus, resetMembers, getOverrides: () => Object.fromEntries(overrides) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true }); else render();
})();
