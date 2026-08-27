(() => {
  const REQUEST_TIMEOUT_MS = 8_000;
  const MAX_GET_BACKOFF_MS = 60_000;
  const DEFAULT_HTTP_BACKOFF_MS = 24_000;
  const MIN_HTTP_BACKOFF_MS = 1_000;
  const originalFetch = window.fetch?.bind(window);
  if (typeof originalFetch !== "function") return;

  let consecutiveGetTimeouts = 0;
  let getBackoffUntil = 0;
  let bypassNextGet = false;
  let getGeneration = 0;
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

  function isSharedLiveRequest(input) { return Boolean(sharedLiveUrl(input)); }
  function requestMethod(input, init = {}) { return String(init?.method || input?.method || "GET").toUpperCase(); }
  function requestSignal(input, init = {}) {
    if (Object.prototype.hasOwnProperty.call(init || {}, "signal")) return init.signal || null;
    return input?.signal || null;
  }

  function getBackoffMs(timeoutCount = consecutiveGetTimeouts) {
    const count = Math.max(0, Number(timeoutCount) || 0);
    if (count <= 1) return 0;
    return Math.min(MAX_GET_BACKOFF_MS, 24_000 * (2 ** (count - 2)));
  }

  function resetGetBackoff() {
    consecutiveGetTimeouts = 0;
    getBackoffUntil = 0;
    bypassNextGet = false;
  }

  function noteGetTimeout(now = Date.now()) {
    consecutiveGetTimeouts += 1;
    const backoffMs = getBackoffMs();
    getBackoffUntil = backoffMs > 0 ? now + backoffMs : 0;
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

  function noteTransientResponse(response, now = Date.now()) {
    const serverRetryMs = retryAfterMs(response, now);
    const retryMs = serverRetryMs == null ? DEFAULT_HTTP_BACKOFF_MS : serverRetryMs;
    getBackoffUntil = now + Math.min(MAX_GET_BACKOFF_MS, Math.max(MIN_HTTP_BACKOFF_MS, retryMs));
    return getBackoffUntil - now;
  }

  function allowNextGet() { bypassNextGet = true; }
  function consumeGetBypass() {
    if (!bypassNextGet) return false;
    bypassNextGet = false;
    return true;
  }
  function shouldBackOffGet(now = Date.now()) { return getBackoffUntil > now; }
  function isCurrentGetGeneration(generation) {
    return generation == null || generation === getGeneration;
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

  function announceTimeout(input, init = {}) {
    try {
      window.dispatchEvent?.(new CustomEvent("nvs-shared-live-timeout", {
        detail: { method: requestMethod(input, init), timeoutMs: REQUEST_TIMEOUT_MS },
      }));
    } catch {}
  }

  function announceTransient(response, retryMs) {
    try {
      window.dispatchEvent?.(new CustomEvent("nvs-shared-live-degraded", {
        detail: { status: Number(response?.status) || 0, retryAfterMs: Math.round(retryMs) },
      }));
    } catch {}
  }

  async function performBoundedFetch(input, init = {}, options = {}) {
    const method = requestMethod(input, init);
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
          const retryMs = noteTransientResponse(response);
          announceTransient(response, retryMs);
        } else {
          resetGetBackoff();
        }
      }
      return response;
    } catch (error) {
      if (timedOut && (method !== "GET" || isCurrentGetGeneration(options.getGeneration))) {
        if (method === "GET") noteGetTimeout();
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
    const forceFresh = consumeGetBypass();
    if (!forceFresh) {
      const pending = pendingGets.get(key);
      if (pending) return consumerView(pending, consumerSignal);
      if (shouldBackOffGet()) return Promise.reject(new DOMException("Shared Live polling is temporarily backed off", "RetryLaterError"));
    }

    const sharedInit = { ...init };
    delete sharedInit.signal;
    const generation = ++getGeneration;
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
    // Invalidate any pre-reconnect GET so a late timeout/503 cannot downgrade a
    // newer healthy connection, and let the next refresh escape old coalescing.
    getGeneration += 1;
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
    getConsecutiveGetTimeouts: () => consecutiveGetTimeouts,
    getBackoffUntil: () => getBackoffUntil,
    getPendingGetCount: () => pendingGets.size,
  });
})();