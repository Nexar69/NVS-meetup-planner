(() => {
  const transit = window.NVSTransit;
  if (!transit?.fetchRoutes || transit.v0111RequestCoalescing) return;

  const BUCKET_MS = 5 * 60_000;
  const pending = new Map();
  const originalFetchRoutes = transit.fetchRoutes.bind(transit);

  function targetTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function requestKey(origin, destination, target) {
    return `${String(origin)}|${String(destination)}|${Math.floor(targetTime(target) / BUCKET_MS)}`;
  }

  function cloneValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
    }
    return value;
  }

  async function fetchRoutes(origin, destination, target) {
    const key = requestKey(origin, destination, target);
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve()
        .then(() => originalFetchRoutes(origin, destination, target))
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }

    const routes = await request;
    // Concurrent consumers must not share mutable route objects. Several planner
    // layers annotate route/segment objects while rendering recommendations.
    return cloneValue(routes);
  }

  window.NVSTransit = Object.freeze({
    ...transit,
    fetchRoutes,
    v0111RequestCoalescing: true,
  });

  window.NVSRoutingCoalescer0111 = Object.freeze({
    pendingCount: () => pending.size,
    requestKey,
  });
})();
