(() => {
  const VERSION = "v0.7.4 · Precise joins + personal itineraries";
  let timer = null;

  function updateVersion() {
    const version = document.getElementById("versionLabel");
    if (version && version.textContent !== VERSION) version.textContent = VERSION;
  }

  function scheduleVersion() {
    clearTimeout(timer);
    timer = setTimeout(updateVersion, 80);
  }

  function loadTestJourneyIfActive() {
    if (!window.NVSTestLab?.active || document.querySelector('script[data-test-lab-journey-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./test-lab-journey-v0111.js";
    script.async = false;
    script.dataset.testLabJourneyV0111 = "true";
    document.body.appendChild(script);
  }

  updateVersion();
  loadTestJourneyIfActive();
  window.addEventListener("load", () => { scheduleVersion(); loadTestJourneyIfActive(); });
  window.addEventListener("nvs-group-recommendations-rendered", scheduleVersion);
  window.addEventListener("nvs-group-change", scheduleVersion);
  window.addEventListener("nvs-priority-change", scheduleVersion);
  window.addEventListener("nvs-timing-change", scheduleVersion);

  const version = document.getElementById("versionLabel");
  if (version) {
    new MutationObserver(() => {
      if (version.textContent !== VERSION) scheduleVersion();
    }).observe(version, { childList: true, characterData: true, subtree: true });
  }
})();