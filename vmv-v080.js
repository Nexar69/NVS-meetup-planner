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

  function locationPoint(key) {
    const location = base.LOCATIONS?.[key];
    if (!location) return null;
    const lat = Number(location.lat);
    const lon = Number(location.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }

  function pointDistanceSquared(a, b) {
    if (!a || !b) return 0;
    const dLat = Number(a[0]) - Number(b[0]);
    const dLon = Number(a[1]) - Number(b[1]);
    return dLat * dLat + dLon * dLon;
  }

  function globallyValid(point) {
    return Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180;
  }

  function schwerinPenalty(point) {
    if (!globallyValid(point)) return 1_000_000;
    const [lat, lon] = point;
    // Generous regional envelope: wide enough for normal trips around Schwerin,
    // but very effective at spotting accidental [lon,lat] pairs such as [11,53].
    if (lat >= 53.2 && lat <= 54.0 && lon >= 10.6 && lon <= 12.3) return 0;
    return 100;
  }

  function orientationScore(points, fromPoint, toPoint) {
    if (!points.length) return 1_000_000;
    const first = points[0];
    const last = points[points.length - 1];
    let score = schwerinPenalty(first) + schwerinPenalty(last);
    if (fromPoint) score += pointDistanceSquared(first, fromPoint) * 20;
    if (toPoint) score += pointDistanceSquared(last, toPoint) * 20;
    return score;
  }

  function orientGeometry(points, fromPoint = null, toPoint = null) {
    const clean = (Array.isArray(points) ? points : []).map(revivePoint).filter(Boolean);
    if (clean.length < 2) return clean;
    const swapped = clean.map(([a, b]) => [b, a]);
    const directScore = orientationScore(clean, fromPoint, toPoint);
    const swappedScore = orientationScore(swapped, fromPoint, toPoint);
    return swappedScore + 0.000001 < directScore ? swapped : clean;
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

  function normalizeRouteGeometry(route, origin, destination) {
    const routeFrom = locationPoint(origin);
    const routeTo = locationPoint(destination);
    const segments = Array.isArray(route?.segments) ? route.segments.map((segment) => {
      const fromPoint = revivePoint(segment?.fromPoint);
      const toPoint = revivePoint(segment?.toPoint);
      return {
        ...segment,
        fromPoint,
        toPoint,
        geometry: orientGeometry(segment?.geometry, fromPoint, toPoint),
        intermediateStops: Array.isArray(segment?.intermediateStops)
          ? segment.intermediateStops.map(reviveStop)
          : [],
      };
    }) : [];

    let geometry = orientGeometry(route?.geometry, routeFrom, routeTo);
    if (geometry.length < 2 && segments.length) {
      geometry = [];
      for (const segment of segments) {
        const points = segment.geometry?.length >= 2
          ? segment.geometry
          : [segment.fromPoint, segment.toPoint].filter(Boolean);
        points.forEach((point, index) => {
          const previous = geometry[geometry.length - 1];
          if (index === 0 && previous && previous[0] === point[0] && previous[1] === point[1]) return;
          geometry.push(point);
        });
      }
    }

    return { ...route, geometry, segments };
  }

  function reviveRoute(route, origin, destination) {
    const departure = asDate(route?.departure);
    const arrival = asDate(route?.arrival);
    if (!departure || !arrival || arrival <= departure) return null;
    return normalizeRouteGeometry({
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
    }, origin, destination);
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
    const normalizedRoutes = routes.map((route) => normalizeRouteGeometry({
      ...route,
      provider: route.provider || "Transitous",
    }, origin, destination));
    lastProvider = "Transitous";
    window.dispatchEvent(new CustomEvent("nvs-routing-provider", {
      detail: { provider: lastProvider, fallback: Boolean(config.backendUrl), reason: lastFallbackReason },
    }));
    return normalizedRoutes;
  }

  window.NVSTransit = Object.freeze({
    ...base,
    fetchRoutes,
    vmvPreferred: true,
    backendConfigured: Boolean(config.backendUrl),
    getProviderStatus: () => ({ provider: lastProvider, fallbackReason: lastFallbackReason }),
  });
})();
