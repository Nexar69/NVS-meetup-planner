(() => {
  const VERSION = "v0.7.4 · Precise joins + personal itineraries";

  function updateVersion() {
    const version = document.getElementById("versionLabel");
    if (version && version.textContent !== VERSION) version.textContent = VERSION;
  }

  updateVersion();
  window.addEventListener("load", updateVersion);
  window.addEventListener("nvs-group-recommendations-rendered", updateVersion);
  window.addEventListener("nvs-group-change", updateVersion);
  window.addEventListener("nvs-priority-change", updateVersion);
  window.addEventListener("nvs-timing-change", updateVersion);
})();