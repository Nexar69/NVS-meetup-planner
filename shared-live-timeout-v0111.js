(() => {
  const REQUEST_TIMEOUT_MS = 8_000;
  const MAX_GET_BACKOFF_MS = 60_000;
  const DEFAULT_HTTP_BACKOFF_MS = 24_000;
  const MIN_HTTP_BACKOFF_MS = 1_000;
  const originalFetch = window.fetch?.bind(window);
  if (typeof originalFetch !== "function") return;

  const getHealthByKey = new Map();
  let bypassNextGet = false;
  let bypassPlanId = "";
  let getGenerationEpoch = 0;
  const getGenerationByKey = new Map();
  const pendingGets = new Map();

  function sharedLiveUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return "";
      const url = new URL(raw, window.location.href);
      return /\/api\/live\/[^/]+\/?$/.test(url.pathname) ? url.href : "";
    } catch {
      return "";
    }
  }

  function planIdFromLiveUrl(input) {
    const url = sharedLiveUrl(input);
    if (!url) return "";
    try {
      const match = new URL(url).pathname.match(/\/api\/live\/([^/]+)\/?$/);
      return match?.[1] || "";
    } catch {
      return "";
    }
  }

  function currentPagePlanId() {
    const fromSharedLive = String(window.NVSSharedLive?.getPlanId?.() || "");
    if (fromSharedLive) return fromSharedLive;
    try {
      return window.location.pathname.match(/^\/p\/([^/]+)\/?$/)?.[1] || "";
    } catch {
      return "";
    }
  }

  function currentPageLiveUrl() {
    const planId = currentPagePlanId();
    if (!planId) return "";
    try {
      return new URL(`/api/live/${encodeURIComponent(planId)}`, window.location.href).href;
    } catch {
      return "";
    }
  }

  function isSharedLiveRequest(input) { return Boolean(sharedLiveUrl(input)); }
  function requestMethod(input, init = {}) { return String(init?.method || input?.method || "GET").toUpperCase(); }
  function requestSignal(input, init = {}) {
    if (Object.prototype.hasOwnProperty.call(init || {}, "signal")) return init.signal || null;
    return input?.signal || null;
  }

  function getHealthState(key, create = false) {
    if (!key) return null;
    let state = getHealthByKey.get(key);
    if (!state && create) {
      state = { consecutiveTimeouts: 0, backoffUntil: 0 };
      getHealthByKey.set(key, state);
    }
    return state || null;
  }

  function healthKey(input = null) {
    return sharedLiveUrl(input) || currentPageLiveUrl();
  }

  function getBackoffMs(timeoutCount = 0) {
    const count = Math.max(0, Number(timeoutCount) || 0);
    if (count <= 1) return 0;
    return Math.min(MAX_GET_BACKOFF_MS, 24_000 * (2 ** (count - 2)));
  }

  function resetGetBackoff(clearBypass = true, input = null) {
    const key = input == null ? "" : healthKey(input);
    if (key) getHealthByKey.delete(key);
    else getHealthByKey.clear();
    if (clearBypass) {
      bypassNextGet = false;
      bypassPlanId = "";
    }
  }

  function noteGetTimeout(key, now = Date.now()) {
    const state = getHealthState(key, true);
    state.consecutiveTimeouts += 1;
    const backoffMs = getBackoffMs(state.consecutiveTimeouts);
    state.backoffUntil = backoffMs > 0 ? now + backoffMs : 0;
    return backoffMs;
  }

  function isTransientStatus(status) {
    const value = Number(status) || 0;
    return value === 408 || value === 429 || value >= 500;
  }

  function retryAfterMs(response, now = Date.now()) {
    const raw = String(response?.headers?.get?.("retry-after") || "").trim();
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_GET_BACKOFF_MS, Math.round(seconds * 1000));
    const date = Date.parse(raw);
    if (!Number.isFinite(date)) return null;
    return Math.min(MAX_GET_BACKOFF_MS, Math.max(0, date - now));
  }

  function noteTransientResponse(key, response, now = Date.now()) {
    const serverRetryMs = retryAfterMs(response, now);
    const retryMs = serverRetryMs == null ? DEFAULT_HTTP_BACKOFF_MS : serverRetryMs;
    const state = getHealthState(key, true);
    state.backoffUntil = now + Math.min(MAX_GET_BACKOFF_MS, Math.max(MIN_HTTP_BACKOFF_MS, retryMs));
    return state.backoffUntil - now;
  }

  function allowNextGet(input = null) {
    const scopedPlanId = planIdFromLiveUrl(input) || currentPagePlanId();
    if (scopedPlanId) {
      bypassPlanId = scopedPlanId;
      bypassNextGet = false;
      return;
    }
    bypassNextGet = true;
    bypassPlanId = "";
  }

  function consumeGetBypass(key) {
    if (bypassPlanId) {
      if (planIdFromLiveUrl(key) !== bypassPlanId) return false;
      bypassPlanId = "";
      return true;
    }
    if (!bypassNextGet) return false;
    bypassNextGet = false;
    return true;
  }

  function shouldBackOffGet(key, now = Date.now()) {
    return (getHealthState(key)?.backoffUntil || 0) > now;
  }

  function nextGetGeneration(key) {
    const value = (getGenerationByKey.get(key) || 0) + 1;
    getGenerationByKey.set(key, value);
    return Object.freeze({ epoch: getGenerationEpoch, key, value });
  }

  function isCurrentGetGeneration(generation) {
    return generation == null || (
      generation.epoch === getGenerationEpoch
      && getGenerationByKey.get(generation.key) === generation.value
    );
  }

  function mergeAbortSignal(existingSignal, controller) {
    if (!existingSignal) return () => {};
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason);
      return () => {};
    }
    const abort = () => controller.abort(existingSignal.reason);
    existingSignal.addEventListener?.("abort", abort, { once: true });
    return () => existingSignal.removeEventListener?.("abort", abort);
  }

  function consumerView(sharedPromise, signal) {
    const clone = (response) => response?.clone ? response.clone() : response;
    if (!signal) return sharedPromise.then(clone);
    if (signal.aborted) return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new DOMException("Aborted", "AbortError"));
      signal.addEventListener?.("abort", abort, { once: true });
      sharedPromise.then((response) => resolve(clone(response)), reject)
        .finally(() => signal.removeEventListener?.("abort", abort));
    });
  }

  function shouldAnnounceForRequest(input) {
    const pagePlanId = currentPagePlanId();
    if (!pagePlanId) return true;
    return planIdFromLiveUrl(input) === pagePlanId;
  }

  function announceTimeout(input, init = {}) {
    if (!shouldAnnounceForRequest(input)) return;
    try {
      window.dispatchEvent?.(new CustomEvent("nvs-shared-live-timeout", {
        detail: { method: requestMethod(input, init), timeoutMs: REQUEST_TIMEOUT_MS },
      }));
    } catch {}
  }

  function announceTransient(input, response, retryMs) {
    if (!shouldAnnounceForRequest(input)) return;
    try {
      window.dispatchEvent?.(new CustomEvent("nvs-shared-live-degraded", {
        detail: { status: Number(response?.status) || 0, retryAfterMs: Math.round(retryMs) },
      }));
    } catch {}
  }

  async function performBoundedFetch(input, init = {}, options = {}) {
    const method = requestMethod(input, init);
    const key = options.getGeneration?.key || sharedLiveUrl(input);
    const controller = new AbortController();
    const callerSignal = options.ignoreInputSignal ? (init?.signal || null) : requestSignal(input, init);
    const detach = mergeAbortSignal(callerSignal, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Shared Live request timed out", "TimeoutError"));
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await originalFetch(input, { ...init, signal: controller.signal });
      if (method === "GET" && isCurrentGetGeneration(options.getGeneration)) {
        if (isTransientStatus(response?.status)) {
          const retryMs = noteTransientResponse(key, response);
          announceTransient(input, response, retryMs);
        } else {
          resetGetBackoff(false, key);
        }
      }
      return response;
    } catch (error) {
      if (timedOut && (method !== "GET" || isCurrentGetGeneration(options.getGeneration))) {
        if (method === "GET") noteGetTimeout(key);
        announceTimeout(input, init);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      detach();
    }
  }

  function sharedGet(input, init = {}) {
    const key = sharedLiveUrl(input);
    const consumerSignal = requestSignal(input, init);
    const forceFresh = consumeGetBypass(key);
    if (!forceFresh) {
      const pending = pendingGets.get(key);
      if (pending) return consumerView(pending, consumerSignal);
      if (shouldBackOffGet(key)) return Promise.reject(new DOMException("Shared Live polling is temporarily backed off", "RetryLaterError"));
    }

    const sharedInit = { ...init };
    delete sharedInit.signal;
    const generation = nextGetGeneration(key);
    const pending = performBoundedFetch(input, sharedInit, { ignoreInputSignal: true, getGeneration: generation }).finally(() => {
      if (pendingGets.get(key) === pending) pendingGets.delete(key);
    });
    pendingGets.set(key, pending);
    return consumerView(pending, consumerSignal);
  }

  function boundedFetch(input, init = {}) {
    if (!isSharedLiveRequest(input)) return originalFetch(input, init);
    const method = requestMethod(input, init);
    if (method === "GET") return sharedGet(input, init);
    return performBoundedFetch(input, init);
  }

  function handleOnline() {
    // Invalidate every pre-reconnect GET so late timeout/503 results cannot
    // downgrade newer healthy connections. Drop only the coalescing references;
    // the old bounded requests may settle for their original consumers, but every
    // shared session can start a genuinely fresh GET after reconnect.
    getGenerationEpoch += 1;
    getGenerationByKey.clear();
    pendingGets.clear();
    resetGetBackoff();
    allowNextGet();
  }

  window.addEventListener?.("online", handleOnline);
  window.fetch = boundedFetch;
  window.NVSSharedLiveTimeout0111 = Object.freeze({
    REQUEST_TIMEOUT_MS,
    MAX_GET_BACKOFF_MS,
    DEFAULT_HTTP_BACKOFF_MS,
    MIN_HTTP_BACKOFF_MS,
    isSharedLiveRequest,
    isTransientStatus,
    retryAfterMs,
    getBackoffMs,
    allowNextGet,
    resetGetBackoff,
    getConsecutiveGetTimeouts: (input = null) => getHealthState(healthKey(input))?.consecutiveTimeouts || 0,
    getBackoffUntil: (input = null) => getHealthState(healthKey(input))?.backoffUntil || 0,
    getPendingGetCount: () => pendingGets.size,
  });
})();