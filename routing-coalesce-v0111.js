(() => {
  const transit = window.NVSTransit;
  if (!transit?.fetchRoutes || transit.v0111RequestCoalescing) return;

  const BUCKET_MS = 5 * 60_000;
  const pending = new Map();
  const originalFetchRoutes = transit.fetchRoutes.bind(transit);
  let plannerConsumerController = null;
  let armedPlannerCalls = 0;

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

  function beginPlannerConsumerBatch() {
    if (typeof AbortController !== "function") return;
    plannerConsumerController?.abort();
    plannerConsumerController = new AbortController();
    // app.js requests exactly two top-level routes per ordinary planner search.
    // Scope cancellation to those two consumers so group/convergence planners
    // cannot accidentally inherit the ordinary planner's abort signal.
    armedPlannerCalls = 2;
  }

  function takePlannerConsumerSignal() {
    if (!plannerConsumerController || armedPlannerCalls <= 0) return undefined;
    armedPlannerCalls -= 1;
    return plannerConsumerController.signal;
  }

  function installPlannerSearchCancellation() {
    if (typeof document === "undefined" || typeof AbortController !== "function") return;

    document.addEventListener("submit", (event) => {
      if (event.target?.id === "plannerForm") beginPlannerConsumerBatch();
    }, true);

    document.addEventListener("click", (event) => {
      const target = event.target?.closest?.("button");
      if (!target) return;
      if (
        target.id === "mobileSearchButton" ||
        target.id === "swapButton" ||
        target.id === "resetButton" ||
        target.hasAttribute("data-time-offset") ||
        target.hasAttribute("data-time-value")
      ) {
        beginPlannerConsumerBatch();
      }
    }, true);
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
    const signal = options?.signal || takePlannerConsumerSignal();
    const routes = await consumeWithoutCancellingSharedRequest(request, signal);

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
    beginPlannerConsumerBatch,
    isConsumerAbort: (error) => error?.name === "AbortError" && error?.code === "NVS_CONSUMER_ABORTED",
  });

  installPlannerSearchCancellation();
})();
