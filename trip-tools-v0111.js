(() => {
  const STATUS_OPTIONS = [
    ["left", "↗ Left"],
    ["on-vehicle", "● On vehicle"],
    ["at-stop", "⌖ At stop"],
    ["missed", "! Missed it"],
    ["arrived", "✓ I'm here"],
  ];
  const CHECKIN_IDLE_TEXT = "Only what you tap is shared. No GPS.";

  let wakeLock = null;
  let wakeWanted = false;
  let wakeRequestGeneration = 0;
  let sendingStatus = false;
  let checkinUiGeneration = 0;
  let recommendationsActive = false;
  let lastRouteUpdate = 0;
  let timer = null;
  let lifecycleFrozen = false;
  let bootstrapObserverConnected = false;

  function tripDialog() {
    return document.getElementById("v011TripDialog");
  }

  function canCheckIn() {
    if (lifecycleFrozen) return false;
    if (window.NVSSharedExpiry0111?.isAuthoritativelyExpired?.()) return false;
    return Boolean(window.NVSSharedLive?.canCheckIn?.());
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function relativeAge(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
    if (seconds < 10) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} min ago`;
  }

  function ensureAccessibility() {
    const primary = document.getElementById("v011PrimaryAlert");
    if (primary) {
      primary.setAttribute("role", "status");
      primary.setAttribute("aria-live", "polite");
      primary.setAttribute("aria-atomic", "true");
    }
    const alert = document.getElementById("v011TripAlert");
    if (alert) {
      alert.setAttribute("role", "status");
      alert.setAttribute("aria-live", "polite");
      alert.setAttribute("aria-atomic", "true");
    }
    const update = document.getElementById("v011UpdateBanner");
    if (update) {
      update.setAttribute("role", "status");
      update.setAttribute("aria-live", "polite");
    }
  }

  function ensureTools() {
    const dialog = tripDialog();
    const shell = dialog?.querySelector(".v011-trip-shell");
    if (!dialog || !shell) return null;
    ensureAccessibility();

    let tools = dialog.querySelector("#v0111TripTools");
    if (tools) return tools;
    tools = document.createElement("section");
    tools.id = "v0111TripTools";
    tools.className = "v0111-trip-tools";
    tools.innerHTML = `
      <div class="v0111-tools-head">
        <div><span>TRIP TOOLS</span><strong>Useful while you're moving</strong></div>
        <span class="v0111-route-age" id="v0111RouteAge"></span>
      </div>
      <div class="v0111-checkins" id="v0111Checkins" hidden>
        <strong>Quick voluntary check-in</strong>
        <div class="v0111-checkin-grid">
          ${STATUS_OPTIONS.map(([status, label]) => `<button type="button" data-v0111-status="${status}">${label}</button>`).join("")}
        </div>
        <div class="v0111-checkin-foot"><small id="v0111CheckinState">${CHECKIN_IDLE_TEXT}</small><button type="button" data-v0111-status="clear" class="clear">Clear</button></div>
      </div>
      <div class="v0111-utility-row">
        <button type="button" id="v0111WakeToggle" class="v0111-wake" aria-pressed="false"><span>☀</span><div><strong>Keep screen awake</strong><small id="v0111WakeDetail">Useful in Trip Mode</small></div><em>Off</em></button>
        <div class="v0111-network" id="v0111Network"></div>
      </div>`;

    const buttons = shell.querySelector(".v011-trip-buttons");
    if (buttons) buttons.insertAdjacentElement("beforebegin", tools);
    else shell.appendChild(tools);

    tools.querySelectorAll("[data-v0111-status]").forEach((button) => {
      button.addEventListener("click", () => sendStatus(button.dataset.v0111Status));
    });
    tools.querySelector("#v0111WakeToggle")?.addEventListener("click", () => setWakeWanted(!wakeWanted));
    render();
    return tools;
  }

  function statusWasApplied(status, beforeAt) {
    const focus = focusIndex();
    const members = window.NVSSharedLive?.getState?.()?.members || {};
    const entry = focus >= 0 ? members[String(focus)] : null;
    if (status === "clear") return !entry;
    return Boolean(entry?.status === status && Number(entry?.at) !== Number(beforeAt));
  }

  function outcomeMessage(outcome, status) {
    if (outcome?.status === "sent") return status === "clear" ? "Check-in cleared." : "Shared just now.";
    if (outcome?.reason === "plan_updated") return "The organizer updated the plan. Reload the latest plan before checking in.";
    if (outcome?.reason === "expired") return "This shared trip has expired. Check-ins are now read-only.";
    if (outcome?.reason === "capability_revoked") return "This private check-in link was reset. Ask the organizer for a fresh personal link.";
    if (outcome?.status === "uncertain") return "Connection interrupted. Check the shared status before sending again.";
    if (outcome?.status === "aborted") return "Check-in cancelled before it was confirmed.";
    if (outcome?.reason === "busy") return "Another check-in is still being sent.";
    if (outcome?.reason === "unavailable") return "Check-in is not available for this view.";
    if (outcome?.status === "rejected") return "The check-in was rejected. Refresh the shared trip before trying again.";
    return "Could not confirm the update. Check the shared status before trying again.";
  }

  function invalidateCheckinUi() {
    checkinUiGeneration += 1;
    sendingStatus = false;
  }

  function reconcileCheckinUiMessage() {
    if (lifecycleFrozen) return;
    const state = document.getElementById("v0111CheckinState");
    if (state?.textContent === "Updating…") state.textContent = CHECKIN_IDLE_TEXT;
  }

  async function sendStatus(status) {
    if (lifecycleFrozen || !canCheckIn() || sendingStatus || !window.NVSSharedLive?.checkIn) return;
    const generation = ++checkinUiGeneration;
    sendingStatus = true;
    render();
    const state = document.getElementById("v0111CheckinState");
    if (state) state.textContent = "Updating…";

    const focus = focusIndex();
    const beforeAt = Number(window.NVSSharedLive?.getState?.()?.members?.[String(focus)]?.at || 0);
    try {
      const outcome = await window.NVSSharedLive.checkIn(status);
      if (lifecycleFrozen || generation !== checkinUiGeneration || document.hidden) return;

      const hasOutcome = Boolean(outcome && typeof outcome === "object" && typeof outcome.status === "string");
      if (!hasOutcome) {
        if (!statusWasApplied(status, beforeAt)) {
          if (state) state.textContent = "Could not confirm the update. Check the shared status before trying again.";
          return;
        }
        if (state) state.textContent = status === "clear" ? "Check-in cleared." : "Shared just now.";
        window.NVSSharedLive.refresh?.();
        return;
      }

      if (state) state.textContent = outcomeMessage(outcome, status);
      if (outcome.status === "sent") window.NVSSharedLive.refresh?.();
    } catch {
      if (!lifecycleFrozen && generation === checkinUiGeneration && !document.hidden && state) {
        state.textContent = "Could not confirm the update. Check the shared status before trying again.";
      }
    } finally {
      if (!lifecycleFrozen && generation === checkinUiGeneration) {
        sendingStatus = false;
        render();
      }
    }
  }

  async function acquireWakeLock() {
    if (lifecycleFrozen || !wakeWanted || document.hidden || !tripDialog()?.open || !navigator.wakeLock?.request || wakeLock) return;
    const generation = ++wakeRequestGeneration;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (lifecycleFrozen || generation !== wakeRequestGeneration || !wakeWanted || document.hidden || !tripDialog()?.open) {
        try { await lock?.release?.(); } catch {}
        return;
      }
      wakeLock = lock;
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
        render();
      }, { once: true });
    } catch {
      if (!lifecycleFrozen && generation === wakeRequestGeneration) wakeLock = null;
    }
    render();
  }

  async function releaseWakeLock() {
    wakeRequestGeneration += 1;
    const lock = wakeLock;
    wakeLock = null;
    try { await lock?.release?.(); } catch {}
    render();
  }

  async function setWakeWanted(next) {
    if (lifecycleFrozen) return;
    wakeWanted = Boolean(next);
    if (wakeWanted) await acquireWakeLock();
    else await releaseWakeLock();
    render();
  }

  function render() {
    if (lifecycleFrozen) return;
    const tools = ensureTools();
    if (!tools) return;

    const checkins = tools.querySelector("#v0111Checkins");
    if (checkins) checkins.hidden = !canCheckIn();
    tools.querySelectorAll("[data-v0111-status]").forEach((button) => { button.disabled = sendingStatus; });

    const age = tools.querySelector("#v0111RouteAge");
    if (age) age.textContent = lastRouteUpdate > 0 ? `Routes ${relativeAge(lastRouteUpdate)}` : "No active route";

    const wake = tools.querySelector("#v0111WakeToggle");
    const wakeDetail = tools.querySelector("#v0111WakeDetail");
    if (wake) {
      const supported = Boolean(navigator.wakeLock?.request);
      wake.disabled = !supported;
      wake.classList.toggle("active", wakeWanted && Boolean(wakeLock));
      wake.setAttribute("aria-pressed", String(wakeWanted));
      const state = wake.querySelector("em");
      if (state) state.textContent = !supported ? "N/A" : wakeWanted ? (wakeLock ? "On" : "Waiting") : "Off";
      if (wakeDetail) wakeDetail.textContent = !supported
        ? "Not supported by this browser"
        : wakeWanted && !wakeLock ? "Will resume when Trip Mode is visible" : "Optional — uses more battery";
    }

    const network = tools.querySelector("#v0111Network");
    if (network) {
      const shared = window.NVSSharedLive?.getState?.();
      const sync = Number(shared?.updatedAt);
      network.innerHTML = `<span class="${navigator.onLine ? "online" : "offline"}">● ${navigator.onLine ? "Online" : "Offline"}</span><small>${Number.isFinite(sync) ? `Shared state ${relativeAge(sync)}` : "Timetable mode"}</small>`;
    }
  }

  function scheduleRender() {
    clearTimeout(timer);
    timer = null;
    if (lifecycleFrozen || document.hidden) return;
    if (document.hidden) return;
    if (!recommendationsActive) return;
    timer = setTimeout(() => {
      if (lifecycleFrozen) return;
      render();
      scheduleRender();
    }, 15_000);
  }

  function attachDialogLifecycle() {
    const dialog = ensureTools()?.closest("dialog");
    if (!dialog || dialog.dataset.v0111Lifecycle === "true") return;
    dialog.dataset.v0111Lifecycle = "true";
    dialog.addEventListener("close", async () => {
      invalidateCheckinUi();
      wakeWanted = false;
      await releaseWakeLock();
      render();
    });
  }

  function start() {
    if (lifecycleFrozen) return;
    ensureTools();
    attachDialogLifecycle();
    render();
    scheduleRender();
  }

  const observer = new MutationObserver(() => {
    if (lifecycleFrozen) return;
    if (tripDialog()) {
      disconnectBootstrapObserver();
      start();
    }
  });

  function disconnectBootstrapObserver() {
    if (!bootstrapObserverConnected) return;
    observer.disconnect();
    bootstrapObserverConnected = false;
  }

  function connectBootstrapObserver() {
    if (lifecycleFrozen || bootstrapObserverConnected || tripDialog()) return;
    observer.observe(document.documentElement, { childList: true, subtree: true });
    bootstrapObserverConnected = true;
  }

  window.addEventListener("nvs-group-recommendations-rendered", () => {
    recommendationsActive = true;
    lastRouteUpdate = Date.now();
    if (lifecycleFrozen) return;
    render();
    scheduleRender();
  });
  window.addEventListener("nvs-recommendations-cleared", () => {
    recommendationsActive = false;
    invalidateCheckinUi();
    clearTimeout(timer);
    timer = null;
    wakeWanted = false;
    lastRouteUpdate = 0;
    releaseWakeLock();
    if (lifecycleFrozen) return;
    reconcileCheckinUiMessage();
    render();
  });
  window.addEventListener("nvs-shared-live-change", () => {
    if (!lifecycleFrozen) render();
  });
  window.addEventListener("nvs-shared-session-expired", () => {
    invalidateCheckinUi();
    if (!lifecycleFrozen) {
      reconcileCheckinUiMessage();
      render();
    }
  });
  window.addEventListener("online", () => {
    if (!lifecycleFrozen) render();
  });
  window.addEventListener("offline", () => {
    if (!lifecycleFrozen) render();
  });
  window.addEventListener("pagehide", () => {
    lifecycleFrozen = true;
    disconnectBootstrapObserver();
    invalidateCheckinUi();
    clearTimeout(timer);
    timer = null;
    wakeRequestGeneration += 1;
    if (wakeLock) releaseWakeLock();
  });
  window.addEventListener("pageshow", () => {
    lifecycleFrozen = false;
    reconcileCheckinUiMessage();
    start();
    connectBootstrapObserver();
    if (wakeWanted && tripDialog()?.open && !document.hidden) acquireWakeLock();
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    timer = null;
    if (lifecycleFrozen) return;
    if (document.hidden) {
      invalidateCheckinUi();
      releaseWakeLock();
      return;
    }
    reconcileCheckinUiMessage();
    if (wakeWanted && tripDialog()?.open) acquireWakeLock();
    render();
    scheduleRender();
  });

  connectBootstrapObserver();

  window.NVSTripTools0111 = Object.freeze({
    refresh: render,
    canCheckIn,
    setWakeLock: setWakeWanted,
    getWakeLockWanted: () => wakeWanted,
    isLifecycleFrozen: () => lifecycleFrozen,
  });

  start();
})();