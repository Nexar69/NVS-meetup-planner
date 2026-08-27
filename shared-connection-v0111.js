(() => {
  const STALE_AFTER_MS = 30_000;
  const RETRY_COOLDOWN_MS = 10_000;
  let lastSuccessAt = 0;
  let lastFailureAt = 0;
  let lastFailureKind = "";
  let successVersion = 0;
  let staleTimer = null;
  let retryTimer = null;
  let retryCooldownUntil = 0;
  let checking = false;

  function clearStaleTimer() { clearTimeout(staleTimer); staleTimer = null; }
  function clearRetryTimer() { clearTimeout(retryTimer); retryTimer = null; }
  function formatAge(ageMs) {
    const seconds = Math.max(0, Math.round(Number(ageMs || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  function hasNewerFailure(successAt = lastSuccessAt, failureAt = lastFailureAt) { return failureAt > 0 && failureAt >= successAt; }
  function retrySeconds(now = Date.now()) {
    if (!(retryCooldownUntil > now)) return 0;
    return Math.max(1, Math.ceil((retryCooldownUntil - now) / 1000));
  }

  function failureCopy(now, successAt, failureAt, kind = lastFailureKind) {
    const reason = kind === "server" ? "server asked us to slow down" : "request timed out";
    return successAt > 0
      ? `Live sync delayed · ${reason} ${formatAge(now - failureAt)} ago`
      : `Live sync delayed · ${reason}`;
  }

  function connectionModel(now = Date.now(), online = navigator.onLine, successAt = lastSuccessAt, failureAt = lastFailureAt, failureKind = lastFailureKind) {
    if (!online) return { status: "offline", text: successAt > 0 ? `Offline · last live response ${formatAge(now - successAt)} ago` : "Offline · no live response yet" };
    if (hasNewerFailure(successAt, failureAt)) return { status: "delayed", text: failureCopy(now, successAt, failureAt, failureKind) };
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
    staleTimer = setTimeout(() => { staleTimer = null; render(); }, remaining + 25);
  }
  function scheduleRetryReady(now = Date.now()) {
    clearRetryTimer();
    if (document.hidden || !navigator.onLine || !(retryCooldownUntil > now)) return;
    retryTimer = setTimeout(() => { retryTimer = null; retryCooldownUntil = 0; render(); }, Math.max(1, retryCooldownUntil - now) + 25);
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
      const cooldownSeconds = retrySeconds(now);
      retry.hidden = model.status !== "delayed" || !navigator.onLine;
      retry.disabled = checking || cooldownSeconds > 0;
      retry.textContent = checking ? "Checking…" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Check now";
      retry.setAttribute?.("aria-label", checking ? "Checking Shared Live now" : cooldownSeconds > 0 ? `Shared Live check available again in ${cooldownSeconds} seconds` : "Check Shared Live now");
    }
  }

  function markSuccess(now = Date.now()) {
    lastSuccessAt = Number(now) || Date.now();
    lastFailureAt = 0;
    lastFailureKind = "";
    successVersion += 1;
    retryCooldownUntil = 0;
    clearRetryTimer();
    const currentNow = Date.now();
    render(currentNow);
    scheduleStale(currentNow);
    return lastSuccessAt;
  }
  function markFailure(now = Date.now(), kind = "timeout") {
    lastFailureAt = Number(now) || Date.now();
    lastFailureKind = kind === "server" ? "server" : "timeout";
    clearStaleTimer();
    render(lastFailureAt);
    return lastFailureAt;
  }

  async function retryNow() {
    const now = Date.now();
    if (checking || document.hidden || !navigator.onLine || retryCooldownUntil > now) return false;
    const refresh = window.NVSSharedLive?.refresh;
    if (typeof refresh !== "function") return false;
    const beforeVersion = successVersion;
    let acknowledged = false;
    checking = true;
    render(now);
    try {
      window.NVSSharedLiveTimeout0111?.allowNextGet?.();
      await refresh();
      acknowledged = successVersion > beforeVersion;
      return acknowledged;
    } catch { return false; }
    finally {
      checking = false;
      if (acknowledged) { retryCooldownUntil = 0; clearRetryTimer(); }
      else if (navigator.onLine) retryCooldownUntil = Date.now() + RETRY_COOLDOWN_MS;
      render();
      scheduleStale();
      scheduleRetryReady();
    }
  }

  function onLiveChange() { markSuccess(Date.now()); }
  function onLiveTimeout() { markFailure(Date.now(), "timeout"); }
  function onLiveDegraded() { markFailure(Date.now(), "server"); }

  window.addEventListener("nvs-shared-live-change", onLiveChange);
  window.addEventListener("nvs-shared-live-timeout", onLiveTimeout);
  window.addEventListener("nvs-shared-live-degraded", onLiveDegraded);
  ["online", "offline", "pageshow", "nvs-group-recommendations-rendered", "nvs-display-options-change", "nvs-shared-view-resumed"].forEach((name) => {
    window.addEventListener(name, () => { render(); scheduleStale(); scheduleRetryReady(); });
  });
  document.addEventListener("visibilitychange", () => {
    clearStaleTimer();
    clearRetryTimer();
    if (!document.hidden) {
      if (retryCooldownUntil <= Date.now()) retryCooldownUntil = 0;
      render();
      scheduleStale();
      scheduleRetryReady();
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
    getLastFailureKind: () => lastFailureKind,
    getSuccessVersion: () => successVersion,
    getRetryCooldownUntil: () => retryCooldownUntil,
  });

  render();
})();