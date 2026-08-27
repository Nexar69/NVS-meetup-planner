(() => {
  const REQUEST_TIMEOUT_MS = 8_000;
  const MAX_GET_BACKOFF_MS = 60_000;
  const originalFetch = window.fetch?.bind(window);
  if (typeof originalFetch !== "function") return;

  let consecutiveGetTimeouts = 0;
  let getBackoffUntil = 0;
  let bypassNextGet = false;

  function isSharedLiveRequest(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      if (!raw) return false;
      const url = new URL(raw, window.location.href);
      return /\/api\/live\/[^/]+\/?$/.test(url.pathname);
    } catch {
      return false;
    }
  }

  function requestMethod(init = {}) {
    return String(init?.method || "GET").toUpperCase();
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

  function allowNextGet() {
    bypassNextGet = true;
  }

  function shouldBackOffGet(now = Date.now()) {
    if (!(getBackoffUntil > now)) return false;
    if (bypassNextGet) {
      bypassNextGet = false;
      return false;
    }
    return true;
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

  function announceTimeout(init = {}) {
    try {
      window.dispatchEvent?.(new CustomEvent("nvs-shared-live-timeout", {
        detail: {
          method: requestMethod(init),
          timeoutMs: REQUEST_TIMEOUT_MS,
        },
      }));
    } catch {}
  }

  async function boundedFetch(input, init = {}) {
    if (!isSharedLiveRequest(input)) return originalFetch(input, init);
    const method = requestMethod(init);
    if (method === "GET" && shouldBackOffGet()) {
      throw new DOMException("Shared Live polling is temporarily backed off", "RetryLaterError");
    }

    const controller = new AbortController();
    const detach = mergeAbortSignal(init?.signal, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Shared Live request timed out", "TimeoutError"));
    }, REQUEST_TIMEOUT_MS);
    try {
      const response = await originalFetch(input, { ...init, signal: controller.signal });
      if (method === "GET") resetGetBackoff();
      return response;
    } catch (error) {
      if (timedOut) {
        if (method === "GET") noteGetTimeout();
        announceTimeout(init);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      detach();
    }
  }

  window.addEventListener?.("online", resetGetBackoff);
  window.fetch = boundedFetch;
  window.NVSSharedLiveTimeout0111 = Object.freeze({
    REQUEST_TIMEOUT_MS,
    MAX_GET_BACKOFF_MS,
    isSharedLiveRequest,
    getBackoffMs,
    allowNextGet,
    resetGetBackoff,
    getConsecutiveGetTimeouts: () => consecutiveGetTimeouts,
    getBackoffUntil: () => getBackoffUntil,
  });
})();