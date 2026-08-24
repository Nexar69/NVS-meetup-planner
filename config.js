(() => {
  // v0.8.1: harden Leaflet for iPad/iOS standalone viewport restores.
  // Home-screen PWAs can resume at a different viewport size without firing the
  // normal resize sequence Leaflet expects, leaving route SVGs visible while
  // the tile grid is stale or blank. Patch map/tile creation before map.js runs.
  if (window.L?.map && !window.__NVS_LEAFLET_RECOVERY__) {
    window.__NVS_LEAFLET_RECOVERY__ = true;

    const maps = new Set();
    const originalMap = window.L.map;
    const originalTileLayer = window.L.tileLayer;
    const observers = new WeakMap();

    function connected(map) {
      const container = map?.getContainer?.();
      return Boolean(container?.isConnected && container.clientWidth > 0 && container.clientHeight > 0);
    }

    function recoverMap(map, redrawTiles = false) {
      if (!connected(map)) return;
      try { map.invalidateSize({ pan: false, debounceMoveend: true }); } catch {}
      if (!redrawTiles) return;
      try {
        map.eachLayer((layer) => {
          if (layer instanceof window.L.TileLayer && typeof layer.redraw === "function") layer.redraw();
        });
      } catch {}
    }

    function scheduleRecovery(map, redrawTiles = false) {
      [0, 80, 280, 750].forEach((delay, index) => {
        setTimeout(() => recoverMap(map, redrawTiles && index >= 1), delay);
      });
    }

    window.L.map = function patchedMap(...args) {
      const map = originalMap.apply(this, args);
      maps.add(map);
      const container = map.getContainer?.();

      if (container && "ResizeObserver" in window) {
        let lastWidth = 0;
        let lastHeight = 0;
        const observer = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect) return;
          const width = Math.round(rect.width);
          const height = Math.round(rect.height);
          if (!width || !height || (width === lastWidth && height === lastHeight)) return;
          lastWidth = width;
          lastHeight = height;
          scheduleRecovery(map, false);
        });
        observer.observe(container);
        observers.set(map, observer);
      }

      map.once("load", () => scheduleRecovery(map, true));
      setTimeout(() => scheduleRecovery(map, true), 120);

      const originalRemove = map.remove.bind(map);
      map.remove = (...removeArgs) => {
        observers.get(map)?.disconnect?.();
        maps.delete(map);
        return originalRemove(...removeArgs);
      };
      return map;
    };

    window.L.tileLayer = function patchedTileLayer(...args) {
      const layer = originalTileLayer.apply(this, args);
      let errors = 0;
      let loaded = 0;
      let retryRounds = 0;
      let lastRetry = 0;
      let retryTimer = null;

      layer.on("tileload", () => {
        loaded += 1;
        errors = Math.max(0, errors - 1);
        if (loaded >= 2) retryRounds = 0;
      });

      layer.on("tileerror", () => {
        errors += 1;
        const now = Date.now();
        if (errors < 3 || retryRounds >= 3 || now - lastRetry < 1200) return;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryRounds += 1;
          lastRetry = Date.now();
          maps.forEach((map) => {
            if (!connected(map) || !map.hasLayer?.(layer)) return;
            recoverMap(map, false);
            try { layer.redraw(); } catch {}
          });
        }, 450);
      });
      return layer;
    };

    function recoverAll(redrawTiles = false) {
      maps.forEach((map) => scheduleRecovery(map, redrawTiles));
    }

    window.addEventListener("pageshow", () => recoverAll(true));
    window.addEventListener("focus", () => recoverAll(false));
    window.addEventListener("online", () => recoverAll(true));
    window.addEventListener("orientationchange", () => setTimeout(() => recoverAll(true), 180));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) recoverAll(true);
    });

    window.NVSMapRecovery = Object.freeze({ recover: () => recoverAll(true) });
  }

  const injectedBackend = String(window.__NVS_BACKEND_URL__ || "").replace(/\/+$/, "");
  const configuredBackend = "https://meet-schwerin.timothy-ua-pa.workers.dev";
  const backendUrl = injectedBackend || configuredBackend;

  window.NVSConfig = Object.freeze({
    appUrl: "https://nexar69.github.io/NVS-meetup-planner/",
    backendUrl,
    preferVmv: true,
    shareTtlSeconds: 72 * 60 * 60,
    hasBackend: Boolean(backendUrl),
    release: "v0.8.1",
  });
})();
