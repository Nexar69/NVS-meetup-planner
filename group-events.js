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