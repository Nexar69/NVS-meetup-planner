(() => {
  if (!window.NVSTestLab?.active || !window.NVSTestJourney?.active || window.NVSTestScenarios?.active) return;

  const PRESETS = Object.freeze([
    { id: "tight-transfer", label: "Tight transfer", detail: "+5 min · jump near next transfer" },
    { id: "missed-transfer", label: "Missed transfer", detail: "jump past transfer · mark missed" },
    { id: "all-arrived", label: "Everyone arrived", detail: "jump past arrival · confirm all here" },
  ]);
  let applying = false;

  const recommendation = () => window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
  const assignments = () => {
    const list = recommendation()?.assignments;
    return Array.isArray(list) ? list.filter((item) => item?.member && item?.route) : [];
  };
  const asTime = (value) => {
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : NaN;
  };

  function transferFor(index) {
    const route = assignments()[index]?.route;
    const segments = Array.isArray(route?.segments) ? route.segments : [];
    for (let segmentIndex = 1; segmentIndex < segments.length; segmentIndex += 1) {
      const time = asTime(segments[segmentIndex]?.departure);
      if (Number.isFinite(time)) return { time, segmentIndex };
    }
    return null;
  }

  function firstTransfer() {
    const list = assignments();
    for (let index = 0; index < list.length; index += 1) {
      const transfer = transferFor(index);
      if (transfer) return { ...transfer, memberIndex: index };
    }
    return null;
  }

  function liveReady() {
    return Boolean(window.NVSSharedLive?.getState?.()?.members);
  }

  function snapshot() {
    return {
      now: window.NVSTestLab.now(),
      statuses: window.NVSTestJourney.getOverrides(),
      delays: window.NVSTestJourney.getRouteDelays(),
    };
  }

  function clearOverlays() {
    window.NVSTestJourney.resetMembers();
    window.NVSTestJourney.resetRouteDelays();
  }

  function restore(state) {
    clearOverlays();
    Object.entries(state.delays || {}).forEach(([index, minutes]) => {
      window.NVSTestJourney.setRouteDelay(Number(index), Number(minutes));
    });
    Object.entries(state.statuses || {}).forEach(([index, status]) => {
      window.NVSTestJourney.setMemberStatus(Number(index), status);
    });
    window.NVSTestLab.setNow(state.now);
  }

  function preflight(preset) {
    const list = assignments();
    if (!list.length) return null;

    if (preset === "tight-transfer") {
      const target = firstTransfer();
      return target ? { list, target } : null;
    }

    if (preset === "missed-transfer") {
      const target = firstTransfer();
      return target && liveReady() ? { list, target } : null;
    }

    if (preset === "all-arrived") {
      if (!liveReady()) return null;
      const arrivals = list.map((item) => asTime(item.route?.arrival)).filter(Number.isFinite);
      return arrivals.length ? { list, arrivals } : null;
    }

    return null;
  }

  function applyPreset(id) {
    if (applying) return false;
    const preset = String(id || "");
    if (!PRESETS.some((item) => item.id === preset)) return false;

    const plan = preflight(preset);
    if (!plan) return false;

    const before = snapshot();
    applying = true;
    let ok = false;
    try {
      clearOverlays();

      if (preset === "tight-transfer") {
        ok = window.NVSTestJourney.setRouteDelay(plan.target.memberIndex, 5)
          && window.NVSTestLab.setNow(plan.target.time - 3 * 60_000);
      }

      if (preset === "missed-transfer") {
        ok = window.NVSTestLab.setNow(plan.target.time + 30_000)
          && window.NVSTestJourney.setMemberStatus(plan.target.memberIndex, "missed");
      }

      if (preset === "all-arrived") {
        const statusOk = plan.list.every((_, index) => window.NVSTestJourney.setMemberStatus(index, "arrived"));
        ok = statusOk && window.NVSTestLab.setNow(Math.max(...plan.arrivals) + 60_000);
      }

      if (!ok) return false;
      window.dispatchEvent(new CustomEvent("nvs-test-scenario-change", { detail: { scenario: preset } }));
      render();
      return true;
    } finally {
      if (!ok) restore(before);
      applying = false;
    }
  }

  function resetScenario() {
    clearOverlays();
    window.dispatchEvent(new CustomEvent("nvs-test-scenario-change", { detail: { scenario: "real" } }));
    render();
    return true;
  }

  function ensureUi() {
    const journey = document.getElementById("nvsTestJourney");
    if (!journey) return null;
    let section = document.getElementById("nvsTestScenarios");
    if (section) return section;
    section = document.createElement("section");
    section.id = "nvsTestScenarios";
    section.innerHTML = `<div class="nvs-test-diagnostics"><strong>Scenario presets</strong><span>Atomic local stress tests · never shared</span></div><div class="nvs-test-actions" id="nvsTestScenarioButtons"></div><p class="nvs-test-note" id="nvsTestScenarioNote"></p>`;
    journey.insertAdjacentElement("afterend", section);
    section.addEventListener("click", (event) => {
      const button = event.target.closest?.("[data-test-scenario]");
      if (!button) return;
      const id = button.dataset.testScenario;
      if (id === "real") resetScenario(); else applyPreset(id);
    });
    return section;
  }

  function render() {
    if (!document.body) return;
    const section = ensureUi();
    if (!section) return;
    const buttons = section.querySelector("#nvsTestScenarioButtons");
    if (buttons) {
      buttons.innerHTML = `${PRESETS.map((preset) => `<button type="button" data-test-scenario="${preset.id}"><span>${preset.label}</span><small>${preset.detail}</small></button>`).join("")}<button type="button" data-test-scenario="real"><span>Clear scenario</span><small>restore real/timetable overlays</small></button>`;
    }
    const note = section.querySelector("#nvsTestScenarioNote");
    if (note) note.textContent = liveReady()
      ? "Presets replace current local overlays. If a preset cannot apply, the previous simulation is restored."
      : "Tight transfer works with loaded routes. Missed transfer and everyone-arrived unlock after read-only Shared Live state loads.";
  }

  window.NVSTestScenarios = Object.freeze({
    active: true,
    presets: PRESETS.map((item) => ({ ...item })),
    applyPreset,
    resetScenario,
  });

  ["nvs-group-recommendations-rendered", "nvs-shared-live-change", "nvs-test-state-change", "nvs-test-route-delay-change", "nvs-test-member-state-change"].forEach((type) => {
    window.addEventListener(type, () => queueMicrotask(render));
  });
  window.addEventListener("load", render);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render, { once: true }); else render();
})();
