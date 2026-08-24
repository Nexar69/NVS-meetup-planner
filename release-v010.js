(() => {
  const VERSION = "v0.10.0 · Shared Live Meetup";

  window.NVSRelease010 = true;
  if (!window.NVSRelease011 && document.documentElement.dataset.nvsRelease !== "011") {
    document.documentElement.dataset.nvsRelease = "010";
  }

  function applyReleaseCopy() {
    if (window.NVSRelease011 || document.documentElement.dataset.nvsRelease === "011") return;
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.10 adds Shared Live Meetup.</strong> Personal short links can voluntarily check in as left, on a vehicle, at a stop, missed or arrived. Everyone viewing that short plan sees the shared status alongside VMV timetable estimates. No background GPS.`;
    }

    const hero = document.querySelector(".hero .subtitle");
    if (hero) {
      hero.textContent = "Plan real public-transport meetups, share personal routes, follow timetable-aware live guidance, and coordinate with voluntary group check-ins when the journey is actually happening.";
    }
  }

  applyReleaseCopy();
  setTimeout(applyReleaseCopy, 350);
  window.addEventListener("load", () => {
    applyReleaseCopy();
    setTimeout(applyReleaseCopy, 150);
  });
})();
