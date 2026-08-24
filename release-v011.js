(() => {
  const VERSION = "v0.11.0 · Meetup Intelligence";

  window.NVSRelease011 = true;
  document.documentElement.dataset.nvsRelease = "011";

  function applyReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.11 adds Meetup Intelligence.</strong> The Journey Command Center combines live actions, voluntary check-ins, delays, cancellations, platform changes, transfer risk, meetup impact and optional alerts without background GPS tracking.`;
    }

    const hero = document.querySelector(".hero .subtitle");
    if (hero) {
      hero.textContent = "Plan group journeys, share personal routes, coordinate voluntary live check-ins, and use one meetup-aware command center for what to do next when the timetable changes.";
    }

    document.title = "Meet Schwerin · Meetup Intelligence";
  }

  applyReleaseCopy();
  setTimeout(applyReleaseCopy, 400);
  window.addEventListener("load", () => {
    applyReleaseCopy();
    setTimeout(applyReleaseCopy, 180);
  });
  window.addEventListener("nvs-group-recommendations-rendered", applyReleaseCopy);
  window.addEventListener("nvs-routing-provider", applyReleaseCopy);
})();
