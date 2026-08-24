(() => {
  const VERSION = "v0.11.1 · Meetup Intelligence";

  window.NVSRelease011 = true;
  document.documentElement.dataset.nvsRelease = "011";

  function loadFreshnessGuard() {
    if (document.querySelector('script[data-shared-freshness-v011="true"]')) return;
    const script = document.createElement("script");
    script.src = "./shared-freshness-v011.js";
    script.async = false;
    script.dataset.sharedFreshnessV011 = "true";
    document.body.appendChild(script);
  }

  function applyReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.11.1 hardens Meetup Intelligence.</strong> Realtime alerts now distinguish early from late vehicles, detect connections that no longer work, use mobile-safe PWA notifications, and add Trip Mode quick check-ins plus an optional keep-screen-awake control.`;
    }

    const hero = document.querySelector(".hero .subtitle");
    if (hero) {
      hero.textContent = "Plan group journeys, share personal routes, coordinate voluntary live check-ins, and use one meetup-aware command center for what to do next when the timetable changes.";
    }

    document.title = "Meet Schwerin · Meetup Intelligence";
  }

  loadFreshnessGuard();
  applyReleaseCopy();
  setTimeout(applyReleaseCopy, 400);
  window.addEventListener("load", () => {
    loadFreshnessGuard();
    applyReleaseCopy();
    setTimeout(applyReleaseCopy, 180);
  });
  window.addEventListener("nvs-group-recommendations-rendered", applyReleaseCopy);
  window.addEventListener("nvs-routing-provider", applyReleaseCopy);
})();
