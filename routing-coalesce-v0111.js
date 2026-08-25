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

  function consumerAbortError() {
    const error = new Error("Routing consumer superseded");
    error.name = "AbortError";
    error.code = "NVS_CONSUMER_ABORTED";
    return error;
  }

  function consumeWithoutCancellingSharedRequest(request, signal) {
    if (!signal) return request;
    if (signal.aborted) return Promise.reject(consumerAbortError());

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => signal.removeEventListener?.("abort", onAbort);
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback(value);
      };
      const onAbort = () => finish(reject, consumerAbortError());

      signal.addEventListener?.("abort", onAbort, { once: true });
      Promise.resolve(request).then(
        (value) => {
          if (signal.aborted) {
            finish(reject, consumerAbortError());
            return;
          }
          finish(resolve, value);
        },
        (error) => finish(reject, error),
      );
    });
  }

  async function fetchRoutes(origin, destination, target, options = undefined) {
    const key = requestKey(origin, destination, target);
    let request = pending.get(key);
    if (!request) {
      request = Promise.resolve()
        .then(() => originalFetchRoutes(origin, destination, target))
        .finally(() => pending.delete(key));
      pending.set(key, request);
    }

    // A UI consumer may stop waiting for an obsolete search without aborting the
    // shared provider request. Other planners can therefore keep using the same
    // in-flight work, preserving request coalescing and provider friendliness.
    const routes = await consumeWithoutCancellingSharedRequest(request, options?.signal);

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
    isConsumerAbort: (error) => error?.name === "AbortError" && error?.code === "NVS_CONSUMER_ABORTED",
  });
})();
