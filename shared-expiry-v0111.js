(() => {
  let timer = null;
  let expiredAnnounced = false;
  let authoritativeExpiryAt = null;

  function sharedState() {
    return window.NVSSharedLive?.getState?.() || null;
  }

  function expiresAt() {
    const value = Number(sharedState()?.expiresAt);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function isAuthoritativelyExpired() {
    return expiredAnnounced;
  }

  function exactLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("de-DE", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }

  function relativeLabel(value, now = Date.now()) {
    const remaining = Math.max(0, value - now);
    const minutes = Math.ceil(remaining / 60_000);
    if (remaining <= 0) return "Shared session expired";
    if (minutes < 60) return `Expires in ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) return `Expires in ${hours}h${restMinutes ? ` ${restMinutes}m` : ""}`;
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return `Expires in ${days}d${restHours ? ` ${restHours}h` : ""}`;
  }

  function ensureIndicator() {
    const panel = document.getElementById("sharedLiveV010");
    if (!panel) return null;
    let indicator = panel.querySelector("#v0111SharedExpiry");
    if (indicator) return indicator;
    indicator = document.createElement("div");
    indicator.id = "v0111SharedExpiry";
    indicator.className = "v0111-shared-expiry";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-live", "polite");
    indicator.hidden = true;
    const head = panel.querySelector(".v010-head");
    if (head) head.insertAdjacentElement("afterend", indicator);
    else panel.prepend(indicator);
    return indicator;
  }

  function applyExpiredState(panel, expired, expiry = null) {
    panel?.classList.toggle("v0111-session-expired", expired);
    if (!expired) return;
    panel?.querySelectorAll("[data-v010-status]").forEach((button) => { button.disabled = true; });
    const note = panel?.querySelector("#v010CheckinNote");
    if (note) note.textContent = "This shared session has expired. Ask the organizer for a new link to continue voluntary check-ins.";
    if (!expiredAnnounced) {
      expiredAnnounced = true;
      authoritativeExpiryAt = Number.isFinite(Number(expiry)) ? Number(expiry) : Date.now();
      window.dispatchEvent(new CustomEvent("nvs-shared-session-expired"));
    }
  }

  function render() {
    const panel = document.getElementById("sharedLiveV010");
    const indicator = ensureIndicator();
    if (!panel || !indicator) return;
    const observedExpiry = expiresAt();
    if (!observedExpiry && !expiredAnnounced) {
      indicator.hidden = true;
      panel.classList.remove("v0111-session-expiring", "v0111-session-expired");
      return;
    }

    const displayExpiry = expiredAnnounced ? (authoritativeExpiryAt || observedExpiry) : observedExpiry;
    const remaining = displayExpiry ? displayExpiry - Date.now() : 0;
    const expired = expiredAnnounced || remaining <= 0;
    const soon = !expired && remaining <= 6 * 60 * 60 * 1000;
    const exact = displayExpiry ? exactLabel(displayExpiry) : "";
    indicator.hidden = false;
    indicator.className = `v0111-shared-expiry${expired ? " expired" : soon ? " soon" : ""}`;
    indicator.innerHTML = expired
      ? `<strong>Shared session expired</strong><small>Automatic shared-session deadline${exact ? ` · ${exact}` : ""}</small>`
      : `<strong>${relativeLabel(displayExpiry)}</strong><small>Automatic shared-session deadline · ${exact}</small>`;
    indicator.title = expired
      ? `This shared session is read-only because its authoritative deadline has passed${exact ? `. Exact expiry: ${exact}.` : "."}`
      : `This deadline comes from the Meet Schwerin backend and is not extended by check-ins or replans. Exact expiry: ${exact}.`;
    panel.classList.toggle("v0111-session-expiring", soon);
    applyExpiredState(panel, expired, displayExpiry);
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    render();
    timer = setTimeout(schedule, 30_000);
  }

  window.addEventListener("nvs-shared-live-change", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) clearTimeout(timer);
    else schedule();
  });

  const observer = new MutationObserver(() => {
    if (document.getElementById("sharedLiveV010")) {
      schedule();
      observer.disconnect();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.NVSSharedExpiry0111 = Object.freeze({
    refresh: render,
    getExpiresAt: expiresAt,
    isAuthoritativelyExpired,
    getAuthoritativeExpiryAt: () => authoritativeExpiryAt,
  });

  schedule();
})();