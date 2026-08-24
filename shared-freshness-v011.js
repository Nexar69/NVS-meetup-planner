(() => {
  const core = window.NVSIntelligenceCore;
  if (!core) return;

  function ago(entry) {
    const freshness = core.checkinFreshness(entry, new Date());
    if (!Number.isFinite(freshness.ageMinutes)) return "";
    return `${Math.max(15, Math.round(freshness.ageMinutes))} min ago`;
  }

  function render() {
    const panel = document.getElementById("sharedLiveV010");
    const state = window.NVSSharedLive?.getState?.();
    if (!panel || !state?.members) return;

    const rows = [...panel.querySelectorAll(".v010-person")];
    rows.forEach((row, index) => {
      const entry = state.members[String(index)] || null;
      const freshness = entry ? core.checkinFreshness(entry, new Date()) : null;
      const stale = Boolean(entry && freshness?.stale);
      row.classList.toggle("v011-stale", stale);
      if (!stale) return;

      const source = row.querySelector(".v010-source");
      const headline = row.querySelector("small");
      const detail = row.querySelector("em");
      if (source) source.textContent = "STALE";
      if (headline && !headline.textContent.startsWith("Stale ·")) headline.textContent = `Stale · ${headline.textContent}`;
      if (detail) detail.textContent = `last confirmed ${ago(entry)} · timetable now preferred`;
    });

    const freshMissed = Object.values(state.members).some((entry) => entry?.status === "missed" && core.checkinFreshness(entry, new Date()).fresh);
    const alert = panel.querySelector("#v010Alert");
    if (alert?.textContent?.includes("Replan suggested") && !freshMissed) alert.hidden = true;
  }

  const style = document.createElement("style");
  style.textContent = `.v010-person.v011-stale{border-style:dashed!important;background:#f9fafb!important;opacity:.78}.v010-person.v011-stale .v010-source{background:#eaecf0!important;color:#667085!important}`;
  document.head.appendChild(style);

  window.addEventListener("nvs-shared-live-change", render);
  window.addEventListener("nvs-group-recommendations-rendered", render);
  window.addEventListener("pageshow", render);
  setInterval(render, 30_000);
  render();
})();
