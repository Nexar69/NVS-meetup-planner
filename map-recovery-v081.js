(() => {
  if (!window.L?.map || window.__NVS_LEAFLET_RECOVERY__) return;
  window.__NVS_LEAFLET_RECOVERY__ = true;

  const maps = new Set();
  const originalMap = window.L.map;
  const originalTileLayer = window.L.tileLayer;
  const observers = new WeakMap();
  const tileState = new WeakMap();

  function mapConnected(map) {
    const container = map?.getContainer?.();
    return Boolean(container?.isConnected && container.clientWidth > 0 && container.clientHeight > 0);
  }

  function recoverMap(map, redrawTiles = false) {
    if (!mapConnected(map)) return;
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
    const state = { errors: 0, loads: 0, retryTimer: null, retryRounds: 0, lastRetry: 0 };
    tileState.set(layer, state);

    layer.on("tileload", () => {
      state.loads += 1;
      state.errors = Math.max(0, state.errors - 1);
      if (state.loads >= 2) state.retryRounds = 0;
    });

    layer.on("tileerror", () => {
      state.errors += 1;
      const now = Date.now();
      if (state.errors < 3 || state.retryRounds >= 3 || now - state.lastRetry < 1200) return;
      clearTimeout(state.retryTimer);
      state.retryTimer = setTimeout(() => {
        state.retryRounds += 1;
        state.lastRetry = Date.now();
        maps.forEach((map) => {
          if (!mapConnected(map) || !map.hasLayer?.(layer)) return;
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
})();
