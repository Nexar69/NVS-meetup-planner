(() => {
  const STALE_AFTER_MS = 30_000;
  let lastSuccessAt = 0;
  let lastFailureAt = 0;
  let successVersion = 0;
  let staleTimer = null;
  let checking = false;

  function clearStaleTimer() {
    clearTimeout(staleTimer);
    staleTimer = null;
  }

  function formatAge(ageMs) {
    const seconds = Math.max(0, Math.round(Number(ageMs || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }

  function hasNewerFailure(successAt = lastSuccessAt, failureAt = lastFailureAt) {
    return failureAt > 0 && failureAt >= successAt;
  }

  function connectionModel(now = Date.now(), online = navigator.onLine, successAt = lastSuccessAt, failureAt = lastFailureAt) {
    if (!online) {
      return {
        status: "offline",
        text: successAt > 0 ? `Offline · last live response ${formatAge(now - successAt)} ago` : "Offline · no live response yet",
      };
    }
    if (hasNewerFailure(successAt, failureAt)) {
      return {
        status: "delayed",
        text: successAt > 0
          ? `Live sync delayed · request timed out ${formatAge(now - failureAt)} ago`
          : "Live sync delayed · shared-live request timed out",
      };
    }
    if (!(successAt > 0)) return { status: "connecting", text: "Connecting to shared live…" };
    const age = Math.max(0, now - successAt);
    if (age <= STALE_AFTER_MS) return { status: "current", text: "Live sync current" };
    return { status: "delayed", text: `Live sync delayed · ${formatAge(age)} since response` };
  }

  function scheduleStale(now = Date.now()) {
    clearStaleTimer();
    if (document.hidden || !navigator.onLine || !(lastSuccessAt > 0) || hasNewerFailure()) return;
    const remaining = STALE_AFTER_MS - Math.max(0, now - lastSuccessAt);
    if (remaining <= 0) return;
    staleTimer = setTimeout(() => {
      staleTimer = null;
      render();
    }, remaining + 25);
  }

  function ensureRetryButton(sync) {
    let button = document.getElementById("v0111SharedConnectionRetry");
    if (button || !sync || typeof document.createElement !== "function") return button;
    button = document.createElement("button");
    button.type = "button";
    button.id = "v0111SharedConnectionRetry";
    button.className = "v0111-shared-connection-retry";
    button.textContent = "Check now";
    button.hidden = true;
    button.addEventListener?.("click", () => { void retryNow(); });
    if (typeof sync.insertAdjacentElement === "function") sync.insertAdjacentElement("afterend", button);
    else sync.parentElement?.appendChild?.(button);
    return button;
  }

  function render(now = Date.now()) {
    const sync = document.getElementById("v010Sync");
    if (!sync) return;
    const model = connectionModel(now);
    sync.dataset.connection = model.status;
    sync.textContent = model.text;
    sync.title = model.status === "current"
      ? "A shared-live response arrived recently."
      : model.status === "delayed"
        ? "Shared Live has not responded as expected. Timetable and saved information may still remain visible."
        : model.status === "offline"
          ? "The browser reports that this device is offline."
          : "Waiting for the first shared-live response.";
    const retry = ensureRetryButton(sync);
    if (retry) {
      retry.hidden = model.status !== "delayed" || !navigator.onLine;
      retry.disabled = checking;
      retry.textContent = checking ? "Checking…" : "Check now";
      retry.setAttribute?.("aria-label", checking ? "Checking Shared Live now" : "Check Shared Live now");
    }
  }

  function markSuccess(now = Date.now()) {
    lastSuccessAt = Number(now) || Date.now();
    lastFailureAt = 0;
    successVersion += 1;
    render(lastSuccessAt);
    scheduleStale(lastSuccessAt);
    return lastSuccessAt;
  }

  function markFailure(now = Date.now()) {
    lastFailureAt = Number(now) || Date.now();
    clearStaleTimer();
    render(lastFailureAt);
    return lastFailureAt;
  }

  async function retryNow() {
    if (checking || document.hidden || !navigator.onLine) return false;
    const refresh = window.NVSSharedLive?.refresh;
    if (typeof refresh !== "function") return false;
    const beforeVersion = successVersion;
    checking = true;
    render();
    try {
      await refresh();
      return successVersion > beforeVersion;
    } catch {
      return false;
    } finally {
      checking = false;
      render();
      scheduleStale();
    }
  }

  function onLiveChange() {
    markSuccess(Date.now());
  }

  function onLiveTimeout() {
    markFailure(Date.now());
  }

  window.addEventListener("nvs-shared-live-change", onLiveChange);
  window.addEventListener("nvs-shared-live-timeout", onLiveTimeout);
  ["online", "offline", "pageshow", "nvs-group-recommendations-rendered", "nvs-display-options-change", "nvs-shared-view-resumed"].forEach((name) => {
    window.addEventListener(name, () => {
      render();
      scheduleStale();
    });
  });
  document.addEventListener("visibilitychange", () => {
    clearStaleTimer();
    if (!document.hidden) {
      render();
      scheduleStale();
    }
  });

  window.NVSSharedConnection0111 = Object.freeze({
    connectionModel,
    markSuccess,
    markFailure,
    retryNow,
    render,
    getLastSuccessAt: () => lastSuccessAt,
    getLastFailureAt: () => lastFailureAt,
    getSuccessVersion: () => successVersion,
  });

  render();
})();