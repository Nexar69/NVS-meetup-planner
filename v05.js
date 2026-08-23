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

  function copyTypeMetadata(select) {
    if (!select) return null;
    return {
      kind: select.dataset.v051Kind || "",
      kindLabel: select.dataset.v051KindLabel || "",
      icon: select.dataset.v051Icon || "",
    };
  }

  function applyTypeMetadata(select, metadata) {
    if (!select) return;
    ["v051Kind", "v051KindLabel", "v051Icon"].forEach((key) => delete select.dataset[key]);
    if (!metadata) return;
    if (metadata.kind) select.dataset.v051Kind = metadata.kind;
    if (metadata.kindLabel) select.dataset.v051KindLabel = metadata.kindLabel;
    if (metadata.icon) select.dataset.v051Icon = metadata.icon;
  }

  function dispatchSelectRefresh(select) {
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function installHiddenSelectSync() {
    const personA = document.getElementById("personA");
    const personB = document.getElementById("personB");
    const destination = document.getElementById("destination");

    document.getElementById("swapButton")?.addEventListener("click", () => {
      const metaA = copyTypeMetadata(personA);
      const metaB = copyTypeMetadata(personB);
      setTimeout(() => {
        applyTypeMetadata(personA, metaB);
        applyTypeMetadata(personB, metaA);
        dispatchSelectRefresh(personA);
        dispatchSelectRefresh(personB);
      }, 0);
    });

    document.getElementById("resetButton")?.addEventListener("click", () => {
      setTimeout(() => {
        [personA, personB, destination].forEach((select) => {
          applyTypeMetadata(select, null);
          dispatchSelectRefresh(select);
        });
      }, 0);
    });

    // The destination remains a normal select in v0.5.1. If the user changes
    // it manually, clear metadata from a previously searched custom result so
    // its type badge is recomputed from the newly selected place.
    destination?.addEventListener("change", (event) => {
      if (!event.isTrusted) return;
      applyTypeMetadata(destination, null);
      setTimeout(() => dispatchSelectRefresh(destination), 0);
    }, { capture: true });
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
  installHiddenSelectSync();
  loadV051UX();
})();
