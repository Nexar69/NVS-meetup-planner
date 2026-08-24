(() => {
  let timer = null;
  let snoozedId = "";

  function alerts() {
    const values = window.NVSIntelligence?.getAlerts?.();
    return Array.isArray(values) ? values : [];
  }

  function recoveryAlert() {
    return alerts().find((item) => item?.replan || item?.kind === "recovery" || String(item?.id || "").startsWith("transfer-missed:")) || null;
  }

  function activeId() {
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) return "pending-plan-update";
    return recoveryAlert()?.id || "";
  }

  function routeAssignments() {
    const primary = window.__NVS_LAST_RECOMMENDATIONS__?.primary;
    return Array.isArray(primary?.assignments)
      ? primary.assignments.filter((item) => item?.member && item?.route)
      : [];
  }

  function assignmentFor(item) {
    const list = routeAssignments();
    if (!list.length || !item) return null;
    if (item.memberId) {
      const match = list.find((assignment) => assignment?.member?.id === item.memberId);
      if (match) return match;
    }
    if (Number.isInteger(item.memberIndex) && list[item.memberIndex]) return list[item.memberIndex];
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    if (Number.isInteger(focus) && focus >= 0 && list[focus]) return list[focus];
    return list[0];
  }

  function timetableHint(item) {
    if (!item) return "";
    const assignment = assignmentFor(item);
    const segments = Array.isArray(assignment?.route?.segments) ? assignment.route.segments : [];
    const index = Number(item.segmentIndex);

    if (String(item.id || "").startsWith("transfer-missed:") && Number.isInteger(index) && index >= 0) {
      const previous = segments[index - 1];
      const next = segments[index];
      const anchor = String(previous?.to || next?.from || "the planned transfer stop").trim();
      const service = next ? window.NVSIntelligenceCore?.vehicleLabel?.(next) : "the next planned service";
      return `Known timetable anchor: ${anchor}. The next planned leg is ${service || "the next service"}; refresh before following it.`;
    }

    if (Number.isInteger(index) && index >= 0 && segments[index]) {
      const segment = segments[index];
      const from = String(segment?.from || "the planned stop").trim();
      const to = String(segment?.to || "the next stop").trim();
      return `Affected planned leg: ${from} → ${to}. Refresh the timetable before following this leg.`;
    }

    if (item.kind === "recovery") {
      return "No current stop is inferred from a voluntary missed-connection check-in; refresh before choosing the next leg.";
    }
    return "";
  }

  function detailWithHint(detail, item) {
    const hint = timetableHint(item);
    return hint ? `${detail} ${hint}` : detail;
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
      snoozedId = activeId();
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
        detail: detailWithHint(item.detail || "Refresh the timetable and calculate a new way to the meetup.", item),
        action: "Refresh & replan",
      };
    }
    if (String(item.id || "").startsWith("transfer-missed:")) {
      return {
        id: item.id,
        title: "This transfer no longer works",
        detail: detailWithHint(item.detail || "Realtime timing now puts the next departure before your arrival. Replan from the known timetable state.", item),
        action: "Find a recovery route",
      };
    }
    return {
      id: item.id,
      title: item.title || "The current plan needs attention",
      detail: detailWithHint(item.detail || "A disruption may prevent the planned meetup. Refresh the timetable before continuing.", item),
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
    if (snoozedId && activeId() !== snoozedId) snoozedId = "";
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
    getTimetableHint: timetableHint,
  });

  start();
})();
