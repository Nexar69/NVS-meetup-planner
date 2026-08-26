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
    const current = Number(document.documentElement.dataset.nvsRelease || 0);
    if (current >= 90) return;
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = "v0.7.0 · Group planning + first-meet priorities";

    const liveNote = document.querySelector(".live-note div");
    if (liveNote) {
      liveNote.innerHTML = `<strong>v0.7 coordinates the whole group.</strong> Add up to six people, rename and colour-code them, choose who should meet first, and keep using Together, Fastest, Easy or ASAP recommendations.`;
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

  function loadGroupEventRouter() {
    if (document.querySelector('script[data-group-events="true"]')) return;
    const script = document.createElement("script");
    script.src = "./group-events.js";
    script.defer = true;
    script.dataset.groupEvents = "true";
    document.body.appendChild(script);
  }

  function loadActionInstructions() {
    if (document.querySelector('script[data-action-instructions="true"]')) return;
    const script = document.createElement("script");
    script.src = "./instructions-v083.js";
    script.defer = true;
    script.dataset.actionInstructions = "true";
    document.body.appendChild(script);
  }

  function loadLiveMeetup() {
    if (!document.querySelector('link[data-live-v090="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./live-v090.css";
      link.dataset.liveV090 = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-live-v090="true"]')) {
      const script = document.createElement("script");
      script.src = "./live-v090.js";
      script.async = false;
      script.dataset.liveV090 = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('script[data-release-v090="true"]')) {
      const script = document.createElement("script");
      script.src = "./release-v090.js";
      script.async = false;
      script.dataset.releaseV090 = "true";
      document.body.appendChild(script);
    }
  }

  function loadSharedLiveMeetup() {
    if (!document.querySelector('script[data-share-v010="true"]')) {
      const script = document.createElement("script");
      script.src = "./share-v010.js";
      script.async = false;
      script.dataset.shareV010 = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('link[data-shared-live-v010="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./shared-live-v010.css";
      link.dataset.sharedLiveV010 = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-shared-live-timeout-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./shared-live-timeout-v0111.js";
      script.async = false;
      script.dataset.sharedLiveTimeoutV0111 = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('script[data-shared-live-v010="true"]')) {
      const script = document.createElement("script");
      script.src = "./shared-live-v010.js";
      script.async = false;
      script.dataset.sharedLiveV010 = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('script[data-release-v010="true"]')) {
      const script = document.createElement("script");
      script.src = "./release-v010.js";
      script.async = false;
      script.dataset.releaseV010 = "true";
      document.body.appendChild(script);
    }
  }

  function loadMeetupIntelligence() {
    if (!document.querySelector('link[data-intelligence-v011="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./intelligence-v011.css";
      link.dataset.intelligenceV011 = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-intelligence-core="true"]')) {
      const script = document.createElement("script");
      script.src = "./intelligence-core.js";
      script.async = false;
      script.dataset.intelligenceCore = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('script[data-intelligence-v011="true"]')) {
      const script = document.createElement("script");
      script.src = "./intelligence-v011.js";
      script.async = false;
      script.dataset.intelligenceV011 = "true";
      document.body.appendChild(script);
    }

    if (!document.querySelector('script[data-release-v011="true"]')) {
      const script = document.createElement("script");
      script.src = "./release-v011.js";
      script.async = false;
      script.dataset.releaseV011 = "true";
      document.body.appendChild(script);
    }
  }

  function loadTripTools0111() {
    if (!document.querySelector('link[data-trip-tools-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./trip-tools-v0111.css";
      link.dataset.tripToolsV0111 = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-trip-tools-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./trip-tools-v0111.js";
      script.async = false;
      script.dataset.tripToolsV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadRecovery0111() {
    if (!document.querySelector('link[data-recovery-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./recovery-v0111.css";
      link.dataset.recoveryV0111 = "true";
      document.head.appendChild(link);
    }

    if (!document.querySelector('script[data-recovery-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./recovery-v0111.js";
      script.async = false;
      script.dataset.recoveryV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadUpdateSafety0111() {
    if (document.querySelector('script[data-update-safety-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./update-safety-v0111.js";
    script.async = false;
    script.dataset.updateSafetyV0111 = "true";
    document.body.appendChild(script);
  }

  installDepartureGuard();
  updateReleaseCopy();
  installHiddenSelectSync();
  loadV051UX();
  loadGroupEventRouter();
  loadActionInstructions();
  loadLiveMeetup();
  loadSharedLiveMeetup();
  loadMeetupIntelligence();
  loadTripTools0111();
  loadRecovery0111();
  loadUpdateSafety0111();
})();
