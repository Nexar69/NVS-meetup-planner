(() => {
  const plannerForm = document.getElementById("plannerForm");
  const mobileSearchButton = document.getElementById("mobileSearchButton");

  plannerForm?.addEventListener("submit", (event) => {
    if (!window.NVSGroup?.search) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.NVSGroup.search({ scrollToResults: window.innerWidth <= 620 });
  }, true);

  mobileSearchButton?.addEventListener("click", (event) => {
    if (!window.NVSGroup?.search) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.NVSGroup.search({ scrollToResults: true });
  }, true);

  document.addEventListener("click", (event) => {
    if (!window.NVSGroup || !window.NVSRecommend) return;

    const optimization = event.target.closest?.("[data-optimization-mode]");
    if (optimization) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.NVSRecommend.setMode?.(optimization.dataset.optimizationMode, { submit: false });
      return;
    }

    const timing = event.target.closest?.("[data-timing-mode]");
    if (timing) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.NVSRecommend.setTimingMode?.(timing.dataset.timingMode, { submit: false });
    }
  }, true);

  document.getElementById("resetButton")?.addEventListener("click", (event) => {
    if (!window.NVSGroup) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      localStorage.removeItem("meet-schwerin-group-v1");
      localStorage.removeItem("nvs-meetup-planner-state-v2");
    } catch {
      // Reset still works without storage access.
    }
    window.location.reload();
  }, true);
})();