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
    if (version) version.textContent = "v0.5.1 · Stop-aware search + focused journey view";

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.5.1 polishes the live companion.</strong> Starting points are search-first, search results clearly distinguish transit stops from streets/places, same-name stops are prioritised, and opening a journey timeline now focuses that option instead of squeezing it into one-third of the screen.`;
    }
  }

  function loadV051UX() {
    if (!document.querySelector('link[data-v051-ux="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./ux-v051.css";
      link.dataset.v051Ux = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-v051-ux="true"]')) {
      const script = document.createElement("script");
      script.src = "./ux-v051.js";
      script.defer = true;
      script.dataset.v051Ux = "true";
      document.body.appendChild(script);
    }
  }

  installDepartureGuard();
  updateReleaseCopy();
  loadV051UX();
})();
