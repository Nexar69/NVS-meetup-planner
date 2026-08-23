(() => {
  function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  function installDepartureGuard() {
    const transit = window.NVSTransit;
    if (!transit?.fetchRoutes || transit.v05DepartureGuard) return;

    const originalFetchRoutes = transit.fetchRoutes;

    async function fetchFreshRoutes(origin, destination, target) {
      const routes = await originalFetchRoutes(origin, destination, target);
      const now = new Date();

      // For a future meetup today, routes that have already departed are no
      // longer actionable. Keep a 30-second grace period for clock jitter.
      if (target instanceof Date && sameLocalDay(target, now) && target.getTime() > now.getTime()) {
        const minimumDeparture = now.getTime() - 30_000;
        return routes.filter((route) => route.departure?.getTime?.() >= minimumDeparture);
      }

      return routes;
    }

    window.NVSTransit = Object.freeze({
      ...transit,
      fetchRoutes: fetchFreshRoutes,
      v05DepartureGuard: true,
    });
  }

  function updateReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = "v0.5.0 · Live departure board + fair meetup beta";

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.5 turns the planner into a live meetup companion.</strong> The best pair gets live leave countdowns and detailed journey timelines. If a departure has already passed, stale routes are ignored and you can recalculate. Fair Meetup compares a small set of central Schwerin hubs only when you explicitly ask it to.`;
    }
  }

  installDepartureGuard();
  updateReleaseCopy();
})();
