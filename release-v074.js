(() => {
  const VERSION = "v0.7.4 · Precise joins + personal itineraries";
  let timer = null;
  let versionObserver = null;
  let lifecycleFrozen = false;
  let lifecycleGeneration = 0;

  function updateVersion() {
    if (lifecycleFrozen) return;
    const version = document.getElementById("versionLabel");
    if (version && version.textContent !== VERSION) version.textContent = VERSION;
  }

  function cancelVersionTimer() {
    clearTimeout(timer);
    timer = null;
  }

  function scheduleVersion() {
    if (lifecycleFrozen) return;
    cancelVersionTimer();
    const generation = lifecycleGeneration;
    timer = setTimeout(() => {
      timer = null;
      if (lifecycleFrozen || generation !== lifecycleGeneration) return;
      updateVersion();
    }, 80);
  }

  function loadTestJourneyIfActive() {
    if (lifecycleFrozen) return;
    if (!window.NVSTestLab?.active || document.querySelector('script[data-test-lab-journey-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./test-lab-journey-v0111.js";
    script.async = false;
    script.dataset.testLabJourneyV0111 = "true";
    document.body.appendChild(script);
  }

  function connectVersionObserver() {
    if (lifecycleFrozen || versionObserver) return;
    const version = document.getElementById("versionLabel");
    if (!version) return;
    versionObserver = new MutationObserver(() => {
      if (lifecycleFrozen) return;
      if (version.textContent !== VERSION) scheduleVersion();
    });
    versionObserver.observe(version, { childList: true, characterData: true, subtree: true });
  }

  function disconnectVersionObserver() {
    versionObserver?.disconnect();
    versionObserver = null;
  }

  function freezeLifecycle() {
    lifecycleFrozen = true;
    lifecycleGeneration += 1;
    cancelVersionTimer();
    disconnectVersionObserver();
  }

  function restoreLifecycle(event) {
    if (!lifecycleFrozen && !event?.persisted) return;
    lifecycleFrozen = false;
    lifecycleGeneration += 1;
    connectVersionObserver();
    updateVersion();
    loadTestJourneyIfActive();
  }

  updateVersion();
  loadTestJourneyIfActive();
  connectVersionObserver();

  window.addEventListener("load", () => {
    if (lifecycleFrozen) return;
    scheduleVersion();
    loadTestJourneyIfActive();
  });
  window.addEventListener("nvs-group-recommendations-rendered", scheduleVersion);
  window.addEventListener("nvs-group-change", scheduleVersion);
  window.addEventListener("nvs-priority-change", scheduleVersion);
  window.addEventListener("nvs-timing-change", scheduleVersion);
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", restoreLifecycle);
})();