(() => {
  let timer = null;
  let snoozedSignature = "";
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary);

  function alerts() {
    const values = window.NVSIntelligence?.getAlerts?.();
    return Array.isArray(values) ? values : [];
  }

  function routeAssignments() {
    const primary = window.__NVS_LAST_RECOMMENDATIONS__?.primary;
    return Array.isArray(primary?.assignments)
      ? primary.assignments.filter((item) => item?.member && item?.route)
      : [];
  }

  function viewContext() {
    const viewer = Boolean(window.NVSShare?.isViewer?.());
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    const list = routeAssignments();
    if (!viewer) {
      return {
        kind: "organizer",
        focus: -1,
        memberId: "",
        label: "RECOVERY · ORGANIZER",
        note: "Replanning here can update the organizer's working meetup and, after sync, the existing shared plan.",
      };
    }
    if (Number.isInteger(focus) && focus >= 0) {
      const assignment = list[focus];
      const name = String(assignment?.member?.name || `Person ${focus + 1}`);
      return {
        kind: "person",
        focus,
        memberId: String(assignment?.member?.id || ""),
        label: `RECOVERY · ${name.toLocaleUpperCase()} VIEW`,
        note: `Replanning here changes only ${name}'s local view; it does not edit the organizer's shared meetup.`,
      };
    }
    return {
      kind: "group",
      focus: -1,
      memberId: "",
      label: "RECOVERY · GROUP VIEW",
      note: "Replanning here changes only this local group view; it does not edit the organizer's shared meetup.",
    };
  }

  function relevantForContext(item, context = viewContext()) {
    if (!item || context.kind !== "person") return Boolean(item);
    if (Number.isInteger(item.memberIndex)) return item.memberIndex === context.focus;
    if (item.memberId) return String(item.memberId) === context.memberId;
    return true;
  }

  function recoveryAlert() {
    const context = viewContext();
    return alerts().find((item) => (
      item?.replan || item?.kind === "recovery" || String(item?.id || "").startsWith("transfer-missed:")
    ) && relevantForContext(item, context)) || null;
  }

  function activeSignature() {
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) return "pending-plan-update";
    const item = recoveryAlert();
    if (!item) return "";
    return [
      item.id,
      item.kind,
      item.title,
      item.detail,
      item.segmentIndex,
      item.memberIndex,
      item.memberId,
      item.replan ? "replan" : "",
    ].map((value) => String(value ?? "").trim()).join("|");
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

  function contextualAction(defaultAction, context = viewContext()) {
    if (context.kind === "organizer") return defaultAction === "Find a recovery route" ? "Replan group" : "Refresh & replan group";
    if (context.kind === "person") return "Replan my route";
    return "Replan this view";
  }

  function reloadPendingPlan() {
    const button = document.getElementById("v0111RecoveryAction");
    const reliableReload = window.NVSSharedReload0111?.reloadUpdatedPlan;
    if (typeof reliableReload === "function") return reliableReload(button);

    try {
      window.location.reload();
      return true;
    } catch {
      try {
        window.location.assign(window.location.href);
        return true;
      } catch {
        return false;
      }
    }
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
        <span id="v0111RecoveryScope">RECOVERY</span>
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
      snoozedSignature = activeSignature();
      render();
    });
    desk.querySelector("#v0111RecoveryAction")?.addEventListener("click", () => {
      if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
        reloadPendingPlan();
        return;
      }
      if (!navigator.onLine) return;
      window.NVSIntelligence?.replan?.();
    });
    return desk;
  }

  function copyFor(item) {
    const context = viewContext();
    if (window.NVSSharedLive?.hasPendingPlanUpdate?.()) {
      return {
        id: "pending-plan-update",
        title: "Use the organizer's updated plan",
        detail: "This shared meetup changed since your route loaded. Reload before posting another check-in or replanning.",
        action: "Reload updated plan",
        context,
      };
    }
    if (!item) return null;
    if (item.kind === "recovery") {
      return {
        id: item.id,
        title: item.title || "A missed connection was reported",
        detail: detailWithHint(item.detail || "Refresh the timetable and calculate a new way to the meetup.", item),
        action: contextualAction("Refresh & replan", context),
        context,
      };
    }
    if (String(item.id || "").startsWith("transfer-missed:")) {
      return {
        id: item.id,
        title: "This transfer no longer works",
        detail: detailWithHint(item.detail || "Realtime timing now puts the next departure before your arrival. Replan from the known timetable state.", item),
        action: contextualAction("Find a recovery route", context),
        context,
      };
    }
    return {
      id: item.id,
      title: item.title || "The current plan needs attention",
      detail: detailWithHint(item.detail || "A disruption may prevent the planned meetup. Refresh the timetable before continuing.", item),
      action: contextualAction("Refresh & replan", context),
      context,
    };
  }

  function render() {
    const desk = ensureDesk();
    if (!desk) return;
    const item = recoveryAlert();
    const model = copyFor(item);
    const signature = activeSignature();
    if (!model || (snoozedSignature && signature === snoozedSignature)) {
      desk.hidden = true;
      return;
    }

    if (snoozedSignature && signature !== snoozedSignature) snoozedSignature = "";
    desk.hidden = false;
    desk.classList.toggle("offline", !navigator.onLine);
    const scope = desk.querySelector("#v0111RecoveryScope");
    const title = desk.querySelector("#v0111RecoveryTitle");
    const detail = desk.querySelector("#v0111RecoveryDetail");
    const action = desk.querySelector("#v0111RecoveryAction");
    const privacy = desk.querySelector("#v0111RecoveryPrivacy");
    if (scope) scope.textContent = model.context?.label || "RECOVERY";
    if (title) title.textContent = model.title;
    const ownership = model.context?.note ? ` ${model.context.note}` : "";
    if (detail) detail.textContent = !navigator.onLine && !window.NVSSharedLive?.hasPendingPlanUpdate?.()
      ? `${model.detail}${ownership} You are offline, so the current route stays visible until connectivity returns.`
      : `${model.detail}${ownership}`;
    if (action) {
      action.textContent = model.action;
      action.disabled = !navigator.onLine && !window.NVSSharedLive?.hasPendingPlanUpdate?.();
    }
    if (privacy) privacy.textContent = window.NVSSharedLive?.hasPendingPlanUpdate?.()
      ? "Reloads the shared plan. No location permission is requested."
      : "Uses timetable data and voluntary check-ins only. No background location.";
  }

  function shouldPoll() {
    return recommendationsActive || Boolean(window.NVSSharedLive?.hasPendingPlanUpdate?.());
  }

  function suspend() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    suspend();
    if (document.hidden || !shouldPoll()) return;
    timer = setTimeout(() => {
      render();
      schedule();
    }, 5_000);
  }

  function start() {
    ensureDesk();
    render();
    schedule();
  }

  window.addEventListener("nvs-group-recommendations-rendered", () => {
    recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__?.primary);
    if (snoozedSignature && activeSignature() !== snoozedSignature) snoozedSignature = "";
    render();
    schedule();
  });
  window.addEventListener("nvs-recommendations-cleared", () => {
    recommendationsActive = false;
    if (snoozedSignature && activeSignature() !== snoozedSignature) snoozedSignature = "";
    render();
    schedule();
  });
  [
    "nvs-shared-live-change",
    "nvs-routing-provider",
    "online",
    "offline",
  ].forEach((name) => window.addEventListener(name, () => {
    if (snoozedSignature && activeSignature() !== snoozedSignature) snoozedSignature = "";
    render();
    schedule();
  }));

  document.addEventListener("visibilitychange", () => {
    suspend();
    if (!document.hidden) {
      render();
      schedule();
    }
  });
  window.addEventListener("pagehide", suspend);
  window.addEventListener("pageshow", start);
  window.addEventListener("load", start);

  window.NVSRecovery0111 = Object.freeze({
    refresh: render,
    getActiveAlert: recoveryAlert,
    getTimetableHint: timetableHint,
    getViewContext: viewContext,
    isRelevantForView: relevantForContext,
    getActiveSignature: activeSignature,
    reloadPendingPlan,
  });

  start();
})();