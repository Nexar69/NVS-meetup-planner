(() => {
  const VERSION = "v0.12.0 · Test Lab";
  window.NVSRelease012 = true;
  document.documentElement.dataset.nvsRelease = "012";

  function loadTestGuard() {
    if (document.querySelector('script[data-test-lab-patch-v012="true"]')) return;
    const script = document.createElement("script");
    script.src = "./test-lab-patch-v012.js";
    script.async = false;
    script.dataset.testLabPatchV012 = "true";
    document.body.appendChild(script);
  }

  function applyReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;
    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.12 adds Test Lab on top of Meetup Intelligence.</strong> Simulate time, speed, route delays, member check-ins and provider failures without writing test statuses to the real shared-live backend. Normal mode keeps using real time and the real providers.`;
    }
    document.title = "Meet Schwerin · Test Lab";
  }

  loadTestGuard();
  applyReleaseCopy();
  setTimeout(applyReleaseCopy, 520);
  window.addEventListener("load", () => {
    loadTestGuard();
    applyReleaseCopy();
    setTimeout(applyReleaseCopy, 260);
  });
  ["nvs-group-recommendations-rendered", "nvs-routing-provider", "nvs-test-state-change"].forEach((name) => {
    window.addEventListener(name, applyReleaseCopy);
  });
})();
