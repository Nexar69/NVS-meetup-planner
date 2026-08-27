(() => {
  if (!window.NVSTestLab?.active || window.NVSTestJourney?.active) return;

  const STATUSES = ["timetable", "left", "on-vehicle", "at-stop", "missed", "arrived"];
  const overrides = new Map();
  const baselines = new Map();
  let applying = false;

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
    if (memberRoot) memberRoot.innerHTML = members.map((assignment, index) => `<label class="nvs-test-field"><span>${esc(assignment.member?.name || `Person ${index + 1}`)}</span><select data-test-member="${index}" ${liveState()?.members ? "" : "disabled"}>${STATUSES.map((status) => `<option value="${status}" ${overrides.get(index) === status || (!overrides.has(index) && status === "timetable") ? "selected" : ""}>${status === "timetable" ? "Real/timetable" : esc(status)}</option>`).join("")}</select></label>`).join("");

    const note = section.querySelector("#nvsTestJourneyNote");
    if (note) note.textContent = liveState()?.members ? "Member overrides are memory-only. Incoming read-only Shared Live data remains the baseline underneath them." : "Member simulation unlocks after a shared session has loaded read-only live state.";
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
