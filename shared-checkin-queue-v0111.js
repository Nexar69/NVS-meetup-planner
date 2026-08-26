(() => {
  const MAX_PENDING_MS = 5 * 60_000;
  const ALLOWED = new Set(["left", "on-vehicle", "at-stop", "missed", "arrived", "clear"]);
  const LABELS = {
    left: "Left",
    "on-vehicle": "On vehicle",
    "at-stop": "At stop",
    missed: "Missed it",
    arrived: "I'm here",
    clear: "Clear my check-in",
  };

  let pending = null;
  let expiryTimer = null;
  let sendingPending = false;
  let lastNotice = "";

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function isExpired(item, now = Date.now()) {
    return !item || !Number.isFinite(Number(item.at)) || now - Number(item.at) >= MAX_PENDING_MS;
  }

  function clearExpiryTimer() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function scheduleExpiry(now = Date.now()) {
    clearExpiryTimer();
    if (document.hidden || !pending) return;
    const remaining = MAX_PENDING_MS - (now - Number(pending.at));
    if (remaining <= 0) {
      expirePending(now);
      return;
    }
    expiryTimer = setTimeout(() => expirePending(Date.now()), remaining + 25);
  }

  function expirePending(now = Date.now()) {
    if (!pending || !isExpired(pending, now)) {
      scheduleExpiry(now);
      return false;
    }
    pending = null;
    sendingPending = false;
    lastNotice = "Pending status expired without being shared. Tap your current status again if you still want to report it.";
    clearExpiryTimer();
    render();
    return true;
  }

  function currentPending(now = Date.now()) {
    if (pending && isExpired(pending, now)) expirePending(now);
    return pending ? { ...pending } : null;
  }

  function queueStatus(status, now = Date.now()) {
    const value = String(status || "");
    if (!ALLOWED.has(value)) return null;
    pending = { status: value, at: Number(now) };
    sendingPending = false;
    lastNotice = "";
    scheduleExpiry(Number(now));
    render();
    return { ...pending };
  }

  function discardPending(message = "Pending status discarded. Nothing was shared.") {
    if (!pending) return false;
    pending = null;
    sendingPending = false;
    lastNotice = message;
    clearExpiryTimer();
    render();
    return true;
  }

  function confirmedByLiveState(status) {
    const focus = focusIndex();
    if (focus < 0) return false;
    const entry = window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
    if (status === "clear") return !entry?.status;
    return entry?.status === status;
  }

  async function sendPending() {
    const item = currentPending();
    if (!item || sendingPending) return false;
    if (!navigator.onLine) {
      lastNotice = "Still offline. The pending status remains only in this tab.";
      render();
      return false;
    }
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
      lastNotice = "The meetup plan changed. Reload the updated plan before sending this pending status.";
      render();
      return false;
    }
    if (!window.NVSSharedLive?.canCheckIn?.()) {
      discardPending("This personal link is read-only now, so the pending status was discarded.");
      return false;
    }

    sendingPending = true;
    lastNotice = "";
    render();
    try {
      await window.NVSSharedLive.checkIn(item.status);
      if (confirmedByLiveState(item.status)) {
        pending = null;
        lastNotice = "Pending status sent successfully.";
        clearExpiryTimer();
        return true;
      }
      if (!window.NVSSharedLive?.canCheckIn?.()) {
        pending = null;
        lastNotice = "This personal link became read-only; the pending status was not shared.";
        clearExpiryTimer();
        return false;
      }
      lastNotice = "Meet Schwerin could not confirm that the status was shared. Check your connection and tap Send now again if it is still correct.";
      return false;
    } finally {
      sendingPending = false;
      render();
    }
  }

  function ensureBanner() {
    const checkin = document.getElementById("v010Checkin");
    if (!checkin) return null;
    let banner = document.getElementById("v0111PendingCheckin");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "v0111PendingCheckin";
    banner.className = "v0111-pending-checkin";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-atomic", "true");
    banner.hidden = true;
    const actions = checkin.querySelector(".v010-checkin-actions");
    if (actions) actions.insertAdjacentElement("afterend", banner);
    else checkin.appendChild(banner);
    return banner;
  }

  function render(now = Date.now()) {
    const item = currentPending(now);
    const banner = ensureBanner();
    if (!banner) return;
    if (!item && !lastNotice) {
      banner.hidden = true;
      banner.innerHTML = "";
      return;
    }

    banner.hidden = false;
    if (!item) {
      banner.className = "v0111-pending-checkin notice";
      banner.innerHTML = `<p>${escapeHtml(lastNotice)}</p>`;
      return;
    }

    const label = LABELS[item.status] || item.status;
    const ageSeconds = Math.max(0, Math.round((now - item.at) / 1000));
    const planChanged = Boolean(window.NVSSharedLive?.hasPendingPlanUpdate?.());
    const writable = Boolean(window.NVSSharedLive?.canCheckIn?.());
    const online = Boolean(navigator.onLine);
    let detail = `“${label}” is saved only in this open tab and has not been shared.`;
    if (planChanged) detail += " The organizer changed the plan; reload before sending it.";
    else if (!writable) detail += " This personal link is currently read-only.";
    else if (online) detail += " Connection is available again. Confirm it is still true, then send it.";
    else detail += " Reconnect within 5 minutes, then confirm and send it.";
    if (lastNotice) detail += ` ${lastNotice}`;

    banner.className = `v0111-pending-checkin ${online ? "online" : "offline"}`;
    banner.innerHTML = `<div><strong>Pending — not shared</strong><small>${escapeHtml(detail)}</small><em>Queued ${ageSeconds < 10 ? "just now" : `${ageSeconds}s ago`}</em></div><div class="v0111-pending-actions"><button type="button" data-v0111-pending-send ${!online || planChanged || !writable || sendingPending ? "disabled" : ""}>${sendingPending ? "Sending…" : "Send now"}</button><button type="button" data-v0111-pending-discard>Discard</button></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function interceptOfflineCheckin(event) {
    const button = event.target?.closest?.("[data-v010-status]");
    if (!button || navigator.onLine) return;
    const status = String(button.dataset.v010Status || "");
    if (!ALLOWED.has(status) || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    queueStatus(status);
    lastNotice = "You are offline, so Meet Schwerin did not attempt to post this status.";
    render();
  }

  document.addEventListener("click", interceptOfflineCheckin, true);
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("[data-v0111-pending-send]")) void sendPending();
    if (event.target?.closest?.("[data-v0111-pending-discard]")) discardPending();
  });
  document.addEventListener("visibilitychange", () => {
    clearExpiryTimer();
    if (!document.hidden) {
      expirePending(Date.now());
      scheduleExpiry();
      render();
    }
  });
  ["online", "offline", "pageshow", "nvs-shared-live-change", "nvs-group-recommendations-rendered", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => {
    window.addEventListener(name, () => {
      expirePending(Date.now());
      scheduleExpiry();
      render();
    });
  });

  window.NVSCheckinQueue0111 = Object.freeze({
    queueStatus,
    getPending: currentPending,
    discardPending,
    sendPending,
    render,
    maxPendingMs: MAX_PENDING_MS,
  });

  render();
})();
