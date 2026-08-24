(() => {
  let timer = null;
  let snoozedId = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function alerts() {
    const values = window.NVSIntelligence?.getAlerts?.();
    return Array.isArray(values) ? values : [];
  }

  function recoveryAlert() {
    return alerts().find((item) => item?.replan || item?.kind === "recovery" || String(item?.id || "").startsWith("transfer-missed:")) || null;
  }

  function ensureDesk() {
    let desk = document.getElementById("v0111RecoveryDesk");
    if (desk) return desk;
    desk = document.createElement("section");
    desk.id = "v0111RecoveryDesk";
    desk.className = "v0111-recovery";
    desk.hidden = true;
    desk.setAttribute("aria-live", "polite");
    desk.setAttribute("aria-atomic", "true");
    desk.innerHTML = `
      <div class="v0111-recovery-icon" aria-hidden="true">↻</div>
      <div class="v0111-recovery-copy">
        <span>RECOVERY</span>
        <strong id="v0111RecoveryTitle">Recovery suggested</strong>
        <small id="v0111RecoveryDetail"></small>
        <em id="v0111RecoveryPrivacy">Uses timetable data and voluntary check-ins only. No background location.</em>
      </div>
      <div class="v0111-recovery-actions">
        <button type="button" class="v0111-recovery-primary" id="v0111RecoveryAction">Refresh & replan</button>
        <button type="button" class="v0111-recovery-later" id="v0111RecoveryLater">Hide for now</button>
      </div>`;

    const command = document.getElementById("v011CommandCenter");
    const shared = document.getElementById("sharedLiveV010");
    if (command) command.insertAdjacentElement("afterend", desk);
    else if (shared) shared.insertAdjacentElement("beforebegin", desk);
    else document.querySelector("main.app")?.appendChild(desk);

    desk.querySelector("#v0111RecoveryLater")?.addEventListener("click", () => {
      const item = recoveryAlert();
      snoozedId = item?.id || "pending-plan-update";
      render();
    });
    desk.querySelector("#v0111RecoveryAction")?.addEventListener("click", () => {
      if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
        window.location.reload();
        return;
      }
      if (!navigator.onLine) return;
      window.NVSIntelligence?.replan?.();
    });
    return desk;
  }

  function copyFor(item) {
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
      return {
        id: "pending-plan-update",
        title: "Use the organizer's updated plan",
        detail: "This shared meetup changed since your route loaded. Reload before posting another check-in or replanning.",
        action: "Reload updated plan",
      };
    }
    if (!item) return null;
    if (item.kind === "recovery") {
      return {
        id: item.id,
        title: item.title || "A missed connection was reported",
        detail: item.detail || "Refresh the timetable and calculate a new way to the meetup.",
        action: "Refresh & replan",
      };
    }
    if (String(item.id || "").startsWith("transfer-missed:")) {
      return {
        id: item.id,
        title: "This transfer no longer works",
        detail: item.detail || "Realtime timing now puts the next departure before your arrival. Replan from the known timetable state.",
        action: "Find a recovery route",
      };
    }
    return {
      id: item.id,
      title: item.title || "The current plan needs attention",
      detail: item.detail || "A disruption may prevent the planned meetup. Refresh the timetable before continuing.",
      action: "Refresh & replan",
    };
  }

  function render() {
    const desk = ensureDesk();
    if (!desk) return;
    const item = recoveryAlert();
    const model = copyFor(item);
    if (!model || model.id === snoozedId) {
      desk.hidden = true;
      return;
    }

    desk.hidden = false;
    desk.classList.toggle("offline", !navigator.onLine);
    const title = desk.querySelector("#v0111RecoveryTitle");
    const detail = desk.querySelector("#v0111RecoveryDetail");
    const action = desk.querySelector("#v0111RecoveryAction");
    const privacy = desk.querySelector("#v0111RecoveryPrivacy");
    if (title) title.textContent = model.title;
    if (detail) detail.textContent = !navigator.onLine && !window.NVSSharedLive?.hasPendingPlanUpdate?.()
      ? `${model.detail} You are offline, so the current route stays visible until connectivity returns.`
      : model.detail;
    if (action) {
      action.textContent = model.action;
      action.disabled = !navigator.onLine && !window.NVSSharedLive?.hasPendingPlanUpdate?.();
    }
    if (privacy) privacy.textContent = window.NVSSharedLive?.hasPendingPlanUpdate?.()
      ? "Reloads the shared plan. No location permission is requested."
      : "Uses timetable data and voluntary check-ins only. No background location.";
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      render();
      if (!document.hidden) schedule();
    }, 5_000);
  }

  function start() {
    ensureDesk();
    render();
    schedule();
  }

  [
    "nvs-group-recommendations-rendered",
    "nvs-shared-live-change",
    "nvs-routing-provider",
    "online",
    "offline",
  ].forEach((name) => window.addEventListener(name, () => {
    if (snoozedId && recoveryAlert()?.id !== snoozedId) snoozedId = "";
    render();
  }));

  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) {
      render();
      schedule();
    }
  });
  window.addEventListener("pageshow", start);
  window.addEventListener("load", start);

  window.NVSRecovery0111 = Object.freeze({
    refresh: render,
    getActiveAlert: recoveryAlert,
  });

  start();
})();
