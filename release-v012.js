(() => {
  const VERSION = "v0.12.0 · Test Lab";
  window.NVSRelease012 = true;
  document.documentElement.dataset.nvsRelease = "012";

  let lifecycleFrozen = false;
  let lifecycleGeneration = 0;
  const timers = new Set();

  function applyReleaseCopy() {
    if (lifecycleFrozen) return;
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;
    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.12 adds Test Lab on top of Meetup Intelligence.</strong> Simulate time, speed, route delays, member check-ins and provider failures without writing test statuses to the real shared-live backend. Normal mode keeps using real time and the real providers.`;
    }
    document.title = "Meet Schwerin · Test Lab";
  }

  function cancelTimers() {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
  }

  function scheduleReleaseCopy(delay) {
    if (lifecycleFrozen) return;
    const generation = lifecycleGeneration;
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (lifecycleFrozen || generation !== lifecycleGeneration) return;
      applyReleaseCopy();
    }, delay);
    timers.add(timer);
  }

  function freezeLifecycle() {
    lifecycleFrozen = true;
    lifecycleGeneration += 1;
    cancelTimers();
  }

  function restoreLifecycle(event) {
    if (!lifecycleFrozen && !event?.persisted) return;
    lifecycleFrozen = false;
    lifecycleGeneration += 1;
    applyReleaseCopy();
  }

  applyReleaseCopy();
  scheduleReleaseCopy(520);
  window.addEventListener("load", () => {
    if (lifecycleFrozen) return;
    applyReleaseCopy();
    scheduleReleaseCopy(260);
  });
  window.addEventListener("nvs-group-recommendations-rendered", applyReleaseCopy);
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", restoreLifecycle);
})();
