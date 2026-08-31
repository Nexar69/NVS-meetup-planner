(() => {
  const MAX_PENDING_MS = 5 * 60_000;
  const CONFIRM_WAIT_MS = 8_000;
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
  let recentAttempt = null;
  let confirmationTimer = null;
  let sendingPending = false;
  let pendingSendGeneration = 0;
  let pendingSendTask = null;
  let lastNotice = "";
  let lifecycleFrozen = false;

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function authoritativelyExpired() {
    return Boolean(window.NVSSharedExpiry0111?.isAuthoritativelyExpired?.());
  }

  function authoritativeExpiryMessage() {
    return "The shared meetup session expired, so the pending status was discarded. Nothing was shared.";
  }

  function isExpired(item, now = Date.now()) {
    return !item || !Number.isFinite(Number(item.at)) || now - Number(item.at) >= MAX_PENDING_MS;
  }

  function clearExpiryTimer() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function clearConfirmationTimer() {
    clearTimeout(confirmationTimer);
    confirmationTimer = null;
  }

  function invalidatePendingSend() {
    pendingSendGeneration += 1;
    pendingSendTask = null;
    sendingPending = false;
  }

  function samePendingItem(item) {
    if (!item || !pending) return false;
    return String(pending.status) === String(item.status)
      && Number(pending.at) === Number(item.at)
      && Number(pending.memberIndex) === Number(item.memberIndex)
      && String(pending.source || "") === String(item.source || "");
  }

  function pendingSendStillOwned(task) {
    return Boolean(task)
      && pendingSendTask === task
      && task.generation === pendingSendGeneration
      && !lifecycleFrozen
      && !document.hidden
      && !authoritativelyExpired()
      && samePendingItem(task.item)
      && Number(task.item.memberIndex) === focusIndex();
  }

  function scheduleExpiry(now = Date.now()) {
    clearExpiryTimer();
    if (lifecycleFrozen || document.hidden || !pending || authoritativelyExpired()) return;
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
    invalidatePendingSend();
    lastNotice = "Pending status expired without being shared. Tap your current status again if you still want to report it.";
    clearExpiryTimer();
    render();
    return true;
  }

  function pendingMatchesMember(item = pending) {
    if (!item) return true;
    return Number(item.memberIndex) === focusIndex();
  }

  function invalidateMemberMismatch() {
    if (!pending || pendingMatchesMember(pending)) return false;
    pending = null;
    invalidatePendingSend();
    lastNotice = "Personal route changed, so the pending status was discarded. Nothing was shared.";
    clearExpiryTimer();
    return true;
  }

  function currentPending(now = Date.now()) {
    if (authoritativelyExpired() && pending) {
      pending = null;
      invalidatePendingSend();
      clearExpiryTimer();
      lastNotice = authoritativeExpiryMessage();
    }
    invalidateMemberMismatch();
    if (pending && isExpired(pending, now)) expirePending(now);
    return pending ? { ...pending } : null;
  }

  function queueStatus(status, now = Date.now(), metadata = null) {
    if (lifecycleFrozen) return null;
    const value = String(status || "");
    const memberIndex = focusIndex();
    if (!ALLOWED.has(value) || memberIndex < 0) return null;
    if (authoritativelyExpired()) {
      clearRecentAttempt();
      invalidatePendingSend();
      pending = null;
      clearExpiryTimer();
      lastNotice = authoritativeExpiryMessage();
      render();
      return null;
    }
    const extra = metadata && typeof metadata === "object" ? metadata : {};
    invalidatePendingSend();
    pending = {
      status: value,
      at: Number(now),
      memberIndex,
      source: extra.source === "unconfirmed" ? "unconfirmed" : "offline",
      baselineAt: Number.isFinite(Number(extra.baselineAt)) ? Number(extra.baselineAt) : null,
      baselineStatus: String(extra.baselineStatus || ""),
    };
    lastNotice = "";
    scheduleExpiry(Number(now));
    render();
    return { ...pending };
  }

  function discardPending(message = "Pending status discarded. Nothing was shared.") {
    if (!pending) {
      invalidatePendingSend();
      return false;
    }
    pending = null;
    invalidatePendingSend();
    lastNotice = message;
    clearExpiryTimer();
    render();
    return true;
  }

  function liveEntry() {
    const focus = focusIndex();
    if (focus < 0) return null;
    return window.NVSSharedLive?.getState?.()?.members?.[String(focus)] || null;
  }

  function confirmedByFreshLiveState(status, before) {
    const after = liveEntry();
    if (status === "clear") return !after?.status;
    if (after?.status !== status) return false;
    const afterAt = Number(after?.at);
    const beforeAt = Number(before?.at);
    if (!Number.isFinite(afterAt)) return false;
    if (!Number.isFinite(beforeAt)) return true;
    return afterAt > beforeAt;
  }

  function confirmedAgainstBaseline(item) {
    if (!item) return false;
    const after = liveEntry();
    if (item.status === "clear") return Boolean(item.baselineStatus) && !after?.status;
    if (after?.status !== item.status) return false;
    const afterAt = Number(after?.at);
    if (!Number.isFinite(afterAt)) return false;
    const baselineAt = Number(item.baselineAt);
    return !Number.isFinite(baselineAt) || afterAt > baselineAt;
  }

  function recentAttemptMatchesMember(item = recentAttempt) {
    if (!item) return true;
    return Number(item.memberIndex) === focusIndex();
  }

  function clearRecentAttempt() {
    recentAttempt = null;
    clearConfirmationTimer();
  }

  function settleUnconfirmedPending() {
    if (lifecycleFrozen) return false;
    const item = pending;
    if (!item || authoritativelyExpired() || item.source !== "unconfirmed" || !pendingMatchesMember(item) || !confirmedAgainstBaseline(item)) return false;
    pending = null;
    invalidatePendingSend();
    clearExpiryTimer();
    lastNotice = "The shared meetup confirmed this status after the slow response. Nothing needs to be sent again.";
    render();
    return true;
  }

  function settleConfirmedAttempt() {
    if (lifecycleFrozen) return false;
    if (!recentAttempt || authoritativelyExpired()) {
      if (authoritativelyExpired()) clearRecentAttempt();
      return false;
    }
    const item = recentAttempt;
    if (!recentAttemptMatchesMember(item)) {
      clearRecentAttempt();
      return false;
    }
    if (!confirmedAgainstBaseline(item)) return false;
    clearRecentAttempt();
    settleUnconfirmedPending();
    return true;
  }

  function promoteUnconfirmedAttempt(now = Date.now()) {
    clearConfirmationTimer();
    if (lifecycleFrozen) return false;
    const item = recentAttempt;
    if (!item || !recentAttemptMatchesMember(item)) {
      clearRecentAttempt();
      return false;
    }
    if (authoritativelyExpired()) {
      clearRecentAttempt();
      pending = null;
      invalidatePendingSend();
      clearExpiryTimer();
      lastNotice = authoritativeExpiryMessage();
      render();
      return false;
    }
    if (settleConfirmedAttempt()) return false;
    const age = now - Number(item.at);
    if (age < CONFIRM_WAIT_MS) {
      scheduleConfirmation(now);
      return false;
    }
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.() || !window.NVSSharedLive?.canCheckIn?.()) {
      clearRecentAttempt();
      return false;
    }
    recentAttempt = null;
    invalidatePendingSend();
    pending = {
      status: item.status,
      at: Number(item.at),
      memberIndex: item.memberIndex,
      source: "unconfirmed",
      baselineAt: item.baselineAt,
      baselineStatus: item.baselineStatus,
    };
    lastNotice = "Meet Schwerin could not confirm that the original status tap was shared. It is kept pending only in this tab; verify it is still true before sending again.";
    scheduleExpiry(now);
    render();
    return true;
  }

  function scheduleConfirmation(now = Date.now()) {
    clearConfirmationTimer();
    if (lifecycleFrozen || document.hidden || !recentAttempt || authoritativelyExpired()) return;
    const remaining = CONFIRM_WAIT_MS - (now - Number(recentAttempt.at));
    if (remaining <= 0) {
      promoteUnconfirmedAttempt(now);
      return;
    }
    confirmationTimer = setTimeout(() => promoteUnconfirmedAttempt(Date.now()), remaining + 25);
  }

  function rememberOnlineAttempt(status, now = Date.now()) {
    if (lifecycleFrozen) return null;
    const value = String(status || "");
    const memberIndex = focusIndex();
    if (!ALLOWED.has(value) || memberIndex < 0 || authoritativelyExpired()) {
      if (authoritativelyExpired()) {
        clearRecentAttempt();
        lastNotice = authoritativeExpiryMessage();
        render();
      }
      return null;
    }
    const before = liveEntry();
    if (value === "clear" && !before?.status) return null;
    recentAttempt = {
      status: value,
      at: Number(now),
      memberIndex,
      baselineAt: Number.isFinite(Number(before?.at)) ? Number(before.at) : null,
      baselineStatus: String(before?.status || ""),
    };
    scheduleConfirmation(Number(now));
    return { ...recentAttempt };
  }

  function definiteOutcomeMessage(outcome) {
    const reason = String(outcome?.reason || "");
    if (reason === "plan_updated") return "The organizer changed the meetup plan, so that status was rejected and was not shared. Reload the updated plan before posting again.";
    if (reason === "capability_revoked") return "This private check-in link was reset, so that status was rejected and was not shared.";
    if (reason === "expired") return "The shared meetup session expired, so that status was not shared.";
    if (reason === "busy") return "Another status update was already sending, so this tap was not sent.";
    if (reason === "unavailable") return "This personal check-in is not currently writable, so that status was not sent.";
    if (reason === "http_error") return "The server rejected that status update, so it was not shared.";
    return "That status update was not sent.";
  }

  function handleCheckinOutcome(event) {
    if (lifecycleFrozen) return;
    const outcome = event?.detail;
    if (!outcome || !recentAttempt) return;
    if (authoritativelyExpired()) {
      clearRecentAttempt();
      lastNotice = authoritativeExpiryMessage();
      render();
      return;
    }
    if (outcome.status === "sent" || outcome.status === "uncertain" || outcome.status === "aborted") return;
    clearRecentAttempt();
    lastNotice = definiteOutcomeMessage(outcome);
    render();
  }

  async function sendPending() {
    if (lifecycleFrozen) return false;
    const item = currentPending();
    if (!item || sendingPending) return false;
    if (authoritativelyExpired()) {
      discardPending(authoritativeExpiryMessage());
      clearRecentAttempt();
      return false;
    }
    if (item.source === "unconfirmed" && confirmedAgainstBaseline(item)) {
      pending = null;
      invalidatePendingSend();
      lastNotice = "This status was already confirmed by the shared meetup. Nothing was sent again.";
      clearExpiryTimer();
      render();
      return true;
    }
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

    const generation = ++pendingSendGeneration;
    const task = { generation, item };
    pendingSendTask = task;
    sendingPending = true;
    lastNotice = "";
    const before = liveEntry();
    render();
    try {
      const outcome = await window.NVSSharedLive.checkIn(item.status);
      if (!pendingSendStillOwned(task)) {
        if (authoritativelyExpired()) {
          pending = null;
          clearExpiryTimer();
          lastNotice = authoritativeExpiryMessage();
        }
        return false;
      }
      if (authoritativelyExpired()) {
        pending = null;
        lastNotice = authoritativeExpiryMessage();
        clearExpiryTimer();
        return false;
      }
      if (outcome?.ok === true || outcome?.status === "sent") {
        pending = null;
        lastNotice = item.status === "clear" ? "No active check-in remains." : "Pending status sent successfully.";
        clearExpiryTimer();
        return true;
      }
      if (outcome?.reason === "plan_updated" || window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
        lastNotice = "The meetup plan changed while this status was sending. The server rejected the stale status; reload the updated plan before deciding whether to send it again.";
        return false;
      }
      if (outcome?.reason === "capability_revoked" || outcome?.reason === "expired") {
        pending = null;
        lastNotice = definiteOutcomeMessage(outcome);
        clearExpiryTimer();
        return false;
      }
      if (outcome?.status === "blocked" || outcome?.status === "rejected") {
        lastNotice = `${definiteOutcomeMessage(outcome)} The pending status remains only in this tab so you can review it.`;
        return false;
      }
      if (isExpired(item)) {
        expirePending(Date.now());
        return false;
      }
      if (confirmedByFreshLiveState(item.status, before)) {
        pending = null;
        lastNotice = item.status === "clear" ? "No active check-in remains." : "Pending status sent successfully.";
        clearExpiryTimer();
        return true;
      }
      if (authoritativelyExpired()) {
        pending = null;
        lastNotice = authoritativeExpiryMessage();
        clearExpiryTimer();
        return false;
      }
      if (!window.NVSSharedLive?.canCheckIn?.()) {
        pending = null;
        lastNotice = "This personal link became read-only; the pending status was not shared.";
        clearExpiryTimer();
        return false;
      }
      lastNotice = outcome?.status === "aborted"
        ? "The send was interrupted before Meet Schwerin could confirm it. The pending status stays only in this tab; verify the shared meetup before sending again."
        : "Meet Schwerin could not confirm a fresh shared update. Check your connection and tap Send now again if the status is still correct.";
      return false;
    } finally {
      if (pendingSendTask === task) {
        pendingSendTask = null;
        sendingPending = false;
        render();
      }
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
    if (lifecycleFrozen) return;
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
    const expired = authoritativelyExpired();
    const writable = !expired && Boolean(window.NVSSharedLive?.canCheckIn?.());
    const online = Boolean(navigator.onLine);
    let detail = `“${label}” is saved only in this open tab and has not been shared.`;
    if (item.source === "unconfirmed") detail = `Meet Schwerin could not confirm whether “${label}” reached the shared meetup. It is saved only in this open tab and will never retry automatically.`;
    if (expired) detail += " The shared meetup session has expired; this status cannot be sent.";
    else if (planChanged) detail += " The organizer changed the plan; reload before sending it.";
    else if (!writable) detail += " This personal link is currently read-only.";
    else if (online) detail += " Confirm it is still true, then send it only if needed.";
    else detail += " Reconnect within 5 minutes, then confirm and send it.";
    if (lastNotice) detail += ` ${lastNotice}`;

    banner.className = `v0111-pending-checkin ${online ? "online" : "offline"}`;
    banner.innerHTML = `<div><strong>Pending — not shared</strong><small>${escapeHtml(detail)}</small><em>Queued ${ageSeconds < 10 ? "just now" : `${ageSeconds}s ago`}</em></div><div class="v0111-pending-actions"><button type="button" data-v0111-pending-send ${!online || expired || planChanged || !writable || sendingPending ? "disabled" : ""}>${sendingPending ? "Sending…" : "Send now"}</button><button type="button" data-v0111-pending-discard>Discard</button></div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function interceptCheckin(event) {
    if (lifecycleFrozen) return;
    const button = event.target?.closest?.("[data-v010-status]");
    if (!button) return;
    const status = String(button.dataset.v010Status || "");
    if (!ALLOWED.has(status) || focusIndex() < 0) return;
    if (authoritativelyExpired()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearRecentAttempt();
      if (!discardPending(authoritativeExpiryMessage())) {
        lastNotice = authoritativeExpiryMessage();
        render();
      }
      return;
    }
    if (button.disabled) return;
    if (navigator.onLine) {
      rememberOnlineAttempt(status);
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    queueStatus(status);
    lastNotice = "You are offline, so Meet Schwerin did not attempt to post this status.";
    render();
  }

  document.addEventListener("click", interceptCheckin, true);
  document.addEventListener("click", (event) => {
    if (lifecycleFrozen) return;
    if (event.target?.closest?.("[data-v0111-pending-send]")) void sendPending();
    if (event.target?.closest?.("[data-v0111-pending-discard]")) discardPending();
  });
  window.addEventListener("nvs-shared-checkin-outcome", handleCheckinOutcome);
  document.addEventListener("visibilitychange", () => {
    clearExpiryTimer();
    clearConfirmationTimer();
    if (lifecycleFrozen) return;
    if (document.hidden) {
      clearRecentAttempt();
      invalidatePendingSend();
      return;
    }
    if (authoritativelyExpired()) {
      clearRecentAttempt();
      if (!discardPending(authoritativeExpiryMessage())) {
        lastNotice = authoritativeExpiryMessage();
        render();
      }
      return;
    }
    settleConfirmedAttempt();
    settleUnconfirmedPending();
    promoteUnconfirmedAttempt(Date.now());
    expirePending(Date.now());
    scheduleExpiry();
    scheduleConfirmation();
    render();
  });
  ["online", "offline", "pageshow", "nvs-shared-live-change", "nvs-group-recommendations-rendered", "nvs-live-plan-synced", "nvs-shared-view-resumed"].forEach((name) => {
    window.addEventListener(name, () => {
      if (name === "pageshow") lifecycleFrozen = false;
      else if (lifecycleFrozen) return;
      if (authoritativelyExpired()) {
        clearRecentAttempt();
        if (!discardPending(authoritativeExpiryMessage())) {
          lastNotice = authoritativeExpiryMessage();
          render();
        }
        return;
      }
      if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
        clearRecentAttempt();
        invalidatePendingSend();
      }
      if (name === "nvs-shared-live-change") {
        settleConfirmedAttempt();
        settleUnconfirmedPending();
      }
      expirePending(Date.now());
      scheduleExpiry();
      scheduleConfirmation();
      render();
    });
  });
  window.addEventListener("pagehide", () => {
    lifecycleFrozen = true;
    clearExpiryTimer();
    clearConfirmationTimer();
    clearRecentAttempt();
    invalidatePendingSend();
  });
  window.addEventListener("nvs-shared-session-expired", () => {
    clearRecentAttempt();
    if (!discardPending(authoritativeExpiryMessage())) {
      lastNotice = authoritativeExpiryMessage();
      render();
    }
  });

  window.NVSCheckinQueue0111 = Object.freeze({
    queueStatus,
    getPending: currentPending,
    discardPending,
    sendPending,
    render,
    rememberOnlineAttempt,
    settleConfirmedAttempt,
    settleUnconfirmedPending,
    promoteUnconfirmedAttempt,
    maxPendingMs: MAX_PENDING_MS,
    confirmWaitMs: CONFIRM_WAIT_MS,
  });

  render();
})();