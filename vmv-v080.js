(() => {
  const base = window.NVSTransit;
  const config = window.NVSConfig || {};
  if (!base?.fetchRoutes) return;

  const cache = new Map();
  const CACHE_MS = 90_000;
  let lastProvider = "Transitous";
  let lastFallbackReason = "";

  function asDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function revivePoint(point) {
    if (!Array.isArray(point) || point.length < 2) return null;
    const lat = Number(point[0]);
    const lon = Number(point[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function reviveStop(stop) {
    if (!stop || typeof stop !== "object") return stop;
    return {
      ...stop,
      arrival: asDate(stop.arrival),
      departure: asDate(stop.departure),
      point: revivePoint(stop.point),
    };
  }

  function reviveRoute(route, origin, destination) {
    const departure = asDate(route?.departure);
    const arrival = asDate(route?.arrival);
    if (!departure || !arrival || arrival <= departure) return null;
    return {
      ...route,
      origin,
      destination,
      departure,
      arrival,
      provider: route.provider || "VMV / MV FÄHRT GUT",
      source: "vmv",
      geometry: Array.isArray(route.geometry) ? route.geometry.map(revivePoint).filter(Boolean) : [],
      segments: Array.isArray(route.segments) ? route.segments.map((segment) => ({
        ...segment,
        departure: asDate(segment.departure),
        arrival: asDate(segment.arrival),
        fromPoint: revivePoint(segment.fromPoint),
        toPoint: revivePoint(segment.toPoint),
        geometry: Array.isArray(segment.geometry) ? segment.geometry.map(revivePoint).filter(Boolean) : [],
        intermediateStops: Array.isArray(segment.intermediateStops) ? segment.intermediateStops.map(reviveStop) : [],
      })) : [],
    };
  }

  function endpointFor(originKey, destinationKey, target) {
    const origin = base.LOCATIONS?.[originKey];
    const destination = base.LOCATIONS?.[destinationKey];
    if (!origin || !destination || !config.backendUrl) return null;
    const url = new URL(`${config.backendUrl}/api/vmv/plan`);
    url.searchParams.set("fromLat", origin.lat);
    url.searchParams.set("fromLon", origin.lon);
    url.searchParams.set("toLat", destination.lat);
    url.searchParams.set("toLon", destination.lon);
    url.searchParams.set("time", target.toISOString());
    return url;
  }

  async function fetchVmv(origin, destination, target) {
    const endpoint = endpointFor(origin, destination, target);
    if (!endpoint) throw new Error("VMV_BACKEND_UNCONFIGURED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`VMV_HTTP_${response.status}`);
      const data = await response.json();
      const routes = (Array.isArray(data?.routes) ? data.routes : [])
        .map((route) => reviveRoute(route, origin, destination))
        .filter(Boolean);
      if (!routes.length) throw new Error("VMV_NO_ROUTES");
      return routes;
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchRoutes(origin, destination, target) {
    if (!(target instanceof Date) || Number.isNaN(target.getTime())) return base.fetchRoutes(origin, destination, target);
    const key = `${origin}|${destination}|${Math.floor(target.getTime() / 300_000)}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.createdAt < CACHE_MS) return cached.routes;

    if (config.preferVmv && config.backendUrl) {
      try {
        const routes = await fetchVmv(origin, destination, target);
        lastProvider = "VMV / MV FÄHRT GUT";
        lastFallbackReason = "";
        cache.set(key, { createdAt: Date.now(), routes });
        window.dispatchEvent(new CustomEvent("nvs-routing-provider", { detail: { provider: lastProvider, fallback: false } }));
        return routes;
      } catch (error) {
        lastFallbackReason = error?.message || "VMV unavailable";
        console.warn("VMV routing unavailable; falling back to Transitous:", error);
      }
    }

    const routes = await base.fetchRoutes(origin, destination, target);
    lastProvider = "Transitous";
    window.dispatchEvent(new CustomEvent("nvs-routing-provider", {
      detail: { provider: lastProvider, fallback: Boolean(config.backendUrl), reason: lastFallbackReason },
    }));
    return routes.map((route) => ({ ...route, provider: route.provider || "Transitous" }));
  }

  window.NVSTransit = Object.freeze({
    ...base,
    fetchRoutes,
    vmvPreferred: true,
    backendConfigured: Boolean(config.backendUrl),
    getProviderStatus: () => ({ provider: lastProvider, fallbackReason: lastFallbackReason }),
  });
})();
