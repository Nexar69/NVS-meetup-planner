(() => {
  const STALE_AFTER_MS = 30_000;
  let lastSuccessAt = 0;
  let staleTimer = null;

  function clearStaleTimer() {
    clearTimeout(staleTimer);
    staleTimer = null;
  }

  function formatAge(ageMs) {
    const seconds = Math.max(0, Math.round(Number(ageMs || 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }

  function connectionModel(now = Date.now(), online = navigator.onLine, successAt = lastSuccessAt) {
    if (!online) {
      return {
        status: "offline",
        text: successAt > 0 ? `Offline · last live response ${formatAge(now - successAt)} ago` : "Offline · no live response yet",
      };
    }
    if (!(successAt > 0)) return { status: "connecting", text: "Connecting to shared live…" };
    const age = Math.max(0, now - successAt);
    if (age <= STALE_AFTER_MS) return { status: "current", text: "Live sync current" };
    return { status: "delayed", text: `Live sync delayed · ${formatAge(age)} since response` };
  }

  function scheduleStale(now = Date.now()) {
    clearStaleTimer();
    if (document.hidden || !navigator.onLine || !(lastSuccessAt > 0)) return;
    const remaining = STALE_AFTER_MS - Math.max(0, now - lastSuccessAt);
    if (remaining <= 0) return;
    staleTimer = setTimeout(() => {
      staleTimer = null;
      render();
    }, remaining + 25);
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
        ? "No shared-live response has arrived within the expected window. Timetable and saved information may still remain visible."
        : model.status === "offline"
          ? "The browser reports that this device is offline."
          : "Waiting for the first shared-live response.";
  }

  function markSuccess(now = Date.now()) {
    lastSuccessAt = Number(now) || Date.now();
    render(lastSuccessAt);
    scheduleStale(lastSuccessAt);
    return lastSuccessAt;
  }

  function onLiveChange() {
    markSuccess(Date.now());
  }

  window.addEventListener("nvs-shared-live-change", onLiveChange);
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
    render,
    getLastSuccessAt: () => lastSuccessAt,
  });

  render();
})();