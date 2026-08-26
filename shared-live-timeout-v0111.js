(() => {
  const REQUEST_TIMEOUT_MS = 8_000;
  const originalFetch = window.fetch?.bind(window);
  if (typeof originalFetch !== "function") return;

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

  async function boundedFetch(input, init = {}) {
    if (!isSharedLiveRequest(input)) return originalFetch(input, init);
    const controller = new AbortController();
    const detach = mergeAbortSignal(init?.signal, controller);
    const timeout = setTimeout(() => controller.abort(new DOMException("Shared Live request timed out", "TimeoutError")), REQUEST_TIMEOUT_MS);
    try {
      return await originalFetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
      detach();
    }
  }

  window.fetch = boundedFetch;
  window.NVSSharedLiveTimeout0111 = Object.freeze({
    REQUEST_TIMEOUT_MS,
    isSharedLiveRequest,
  });
})();
