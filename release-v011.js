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

  function loadSharedLiveFreshness0111() {
    if (document.querySelector('script[data-shared-live-freshness-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./shared-live-freshness-v0111.js";
    script.async = false;
    script.dataset.sharedLiveFreshnessV0111 = "true";
    document.body.appendChild(script);
  }

  function loadSharedReload0111() {
    if (document.querySelector('script[data-shared-reload-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./shared-reload-v0111.js";
    script.async = false;
    script.dataset.sharedReloadV0111 = "true";
    document.body.appendChild(script);
  }

  function loadRoutingCoalescer0111() {
    if (document.querySelector('script[data-routing-coalesce-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./routing-coalesce-v0111.js";
    script.async = false;
    script.dataset.routingCoalesceV0111 = "true";
    document.body.appendChild(script);
  }

  function loadAccessibility0111() {
    if (!document.querySelector('link[data-accessibility-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./accessibility-v0111.css";
      link.dataset.accessibilityV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-accessibility-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./accessibility-v0111.js";
      script.async = false;
      script.dataset.accessibilityV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadProviderHealth0111() {
    if (!document.querySelector('link[data-provider-health-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./provider-health-v0111.css";
      link.dataset.providerHealthV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-provider-health-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./provider-health-v0111.js";
      script.async = false;
      script.dataset.providerHealthV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadSharedExpiry0111() {
    if (!document.querySelector('link[data-shared-expiry-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./shared-expiry-v0111.css";
      link.dataset.sharedExpiryV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-shared-expiry-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./shared-expiry-v0111.js";
      script.async = false;
      script.dataset.sharedExpiryV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadTripGuidance0111() {
    if (!document.querySelector('link[data-trip-guidance-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./trip-guidance-v0111.css";
      link.dataset.tripGuidanceV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-trip-guidance-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./trip-guidance-v0111.js";
      script.async = false;
      script.dataset.tripGuidanceV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadStopAwareness0111() {
    if (!document.querySelector('link[data-stop-awareness-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./stop-awareness-v0111.css";
      link.dataset.stopAwarenessV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-stop-awareness-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./stop-awareness-v0111.js";
      script.async = false;
      script.dataset.stopAwarenessV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadDiagnostics0111() {
    if (!document.querySelector('link[data-diagnostics-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./diagnostics-v0111.css";
      link.dataset.diagnosticsV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-diagnostics-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./diagnostics-v0111.js";
      script.async = false;
      script.dataset.diagnosticsV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadMeetupRadar0111() {
    if (!document.querySelector('link[data-meetup-radar-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./meetup-radar-v0111.css";
      link.dataset.meetupRadarV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-meetup-radar-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./meetup-radar-v0111.js";
      script.async = false;
      script.dataset.meetupRadarV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadWhatIf0111() {
    if (!document.querySelector('link[data-what-if-v0111="true"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "./what-if-v0111.css";
      link.dataset.whatIfV0111 = "true";
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-what-if-v0111="true"]')) {
      const script = document.createElement("script");
      script.src = "./what-if-v0111.js";
      script.async = false;
      script.dataset.whatIfV0111 = "true";
      document.body.appendChild(script);
    }
  }

  function loadIntelligenceVoluntarySync0111() {
    if (document.querySelector('script[data-intelligence-voluntary-sync-v0111="true"]')) return;
    const script = document.createElement("script");
    script.src = "./intelligence-voluntary-sync-v0111.js";
    script.async = false;
    script.dataset.intelligenceVoluntarySyncV0111 = "true";
    document.body.appendChild(script);
  }

  function applyReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;
    const liveNote = document.querySelector(".live-note div");
    if (liveNote) liveNote.innerHTML = `<strong>v0.11.1 hardens Meetup Intelligence.</strong> Realtime alerts distinguish early from late vehicles and impossible transfers, Trip Mode adds voluntary quick check-ins and optional screen wake lock, personal journeys add timetable-only stop awareness, Meetup Radar summarizes planned group convergence, the local What if? tool previews +5/+10 minute delays without changing the shared plan, shared links use a non-sliding backend expiry deadline, organizers can reset private personal check-in links without erasing visible check-in history, mobile PWA notifications are safer, and privacy-safe diagnostics make real-device bug reports easier.`;
    const hero = document.querySelector(".hero .subtitle");
    if (hero) hero.textContent = "Plan group journeys, share personal routes, coordinate voluntary live check-ins, and use one meetup-aware command center for what to do next when the timetable changes.";
    document.title = "Meet Schwerin · Meetup Intelligence";
  }

  loadFreshnessGuard();
  loadSharedLiveFreshness0111();
  loadSharedReload0111();
  loadRoutingCoalescer0111();
  loadAccessibility0111();
  loadProviderHealth0111();
  loadSharedExpiry0111();
  loadTripGuidance0111();
  loadStopAwareness0111();
  loadDiagnostics0111();
  loadMeetupRadar0111();
  loadWhatIf0111();
  loadIntelligenceVoluntarySync0111();
  applyReleaseCopy();
  setTimeout(applyReleaseCopy, 400);
  window.addEventListener("load", () => {
    loadFreshnessGuard();
    loadSharedLiveFreshness0111();
    loadSharedReload0111();
    loadRoutingCoalescer0111();
    loadAccessibility0111();
    loadProviderHealth0111();
    loadSharedExpiry0111();
    loadTripGuidance0111();
    loadStopAwareness0111();
    loadDiagnostics0111();
    loadMeetupRadar0111();
    loadWhatIf0111();
    loadIntelligenceVoluntarySync0111();
    applyReleaseCopy();
    setTimeout(applyReleaseCopy, 180);
  });
  window.addEventListener("nvs-group-recommendations-rendered", applyReleaseCopy);
  window.addEventListener("nvs-routing-provider", applyReleaseCopy);
})();
