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

  updateVersion();
  window.addEventListener("load", scheduleVersion);
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