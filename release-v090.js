(() => {
  const VERSION = "v0.9.0 · Live Meetup Mode";

  function applyReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.9 adds Live Meetup Mode.</strong> Follow the current and next action, see ★ meetup health, refresh realtime timetable data before departure, and replan explicitly once somebody is underway. Progress is timetable-based — never hidden GPS tracking.`;
    }

    const hero = document.querySelector(".hero .subtitle");
    if (hero) {
      hero.textContent = "Plan real public-transport meetups for two to six people, share personal routes, see where friends join, and follow the meetup live with timetable-aware next-step guidance.";
    }
  }

  applyReleaseCopy();
  window.addEventListener("load", applyReleaseCopy);
})();
