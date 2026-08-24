(() => {
  const POLL_MS = 12_000;
  const STATUS_COPY = {
    left: { icon: "↗", label: "Left", tone: "live" },
    "on-vehicle": { icon: "●", label: "On vehicle", tone: "live" },
    "at-stop": { icon: "⌖", label: "At stop", tone: "wait" },
    missed: { icon: "!", label: "Missed it", tone: "warn" },
    arrived: { icon: "✓", label: "I'm here", tone: "good" },
  };

  let timer = null;
  let liveState = null;
  let sending = false;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function planId() {
    const match = window.location.pathname.match(/^\/p\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12})\/?$/);
    return match?.[1] || "";
  }

  function sharedPlan() {
    return window.NVSShare?.getSharedPlan?.() || null;
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function apiUrl() {
    const id = planId();
    if (!id) return "";
    const backend = window.__NVS_BACKEND_URL__ || window.NVSConfig?.backendUrl || window.location.origin;
    return `${String(backend).replace(/\/$/, "")}/api/live/${id}`;
  }

  function ago(value) {
    const at = Number(value);
    if (!Number.isFinite(at)) return "";
    const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (seconds < 15) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  }

  function assignments() {
    const list = window.__NVS_LAST_RECOMMENDATIONS__?.primary?.assignments;
    return Array.isArray(list) ? list : [];
  }

  function suggestedNote(status) {
    const focus = focusIndex();
    const assignment = assignments()[focus];
    if (!assignment) return "";
    const state = window.NVSLiveMeetup?.routeState?.(assignment, new Date());
    if (status === "on-vehicle") {
      if (state?.phase === "moving") return String(state.label || "On route").slice(0, 80);
      const segment = assignment.route?.segments?.[state?.nextIndex ?? -1];
      const instruction = segment ? window.NVSInstructions?.instructionFor?.(segment) : null;
      return String(instruction?.title || "On public transport").slice(0, 80);
    }
    if (status === "at-stop") {
      if (state?.phase === "transfer") return String(state.detail || "Waiting for next connection").slice(0, 80);
      if (state?.phase === "waiting") return String(assignment.route?.segments?.[0]?.from || "Start stop").slice(0, 80);
      return String(state?.nextLabel || state?.detail || "At a stop").slice(0, 80);
    }
    if (status === "missed") return String(state?.detail || state?.label || "Connection missed").slice(0, 80);
    if (status === "left") return String(assignment.route?.segments?.[0]?.from || "Started journey").slice(0, 80);
    if (status === "arrived") return String(assignment.route?.segments?.at?.(-1)?.to || sharedPlan()?.destination?.label || "Meetup").slice(0, 80);
    return "";
  }

  async function sendStatus(status) {
    const url = apiUrl();
    const focus = focusIndex();
    if (!url || focus < 0 || sending) return;
    sending = true;
    render();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ member: focus, status, note: status === "clear" ? "" : suggestedNote(status) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      liveState = await response.json();
      render();
      window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: liveState }));
    } catch (error) {
      console.warn("Shared check-in failed", error);
      const note = document.getElementById("v010CheckinNote");
      if (note) note.textContent = "Could not update the shared status. Try again when you're online.";
    } finally {
      sending = false;
      render();
    }
  }

  async function poll() {
    const url = apiUrl();
    if (!url || document.hidden) return;
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" });
      if (!response.ok) return;
      liveState = await response.json();
      render();
      window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: liveState }));
    } catch {
      // Keep the most recent state visible while temporarily offline.
    }
  }

  function ensurePanel() {
    if (!planId() || !sharedPlan()) return null;
    let panel = document.getElementById("sharedLiveV010");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "sharedLiveV010";
    panel.className = "v010-shared-live";
    panel.innerHTML = `
      <div class="v010-head">
        <div>
          <span class="v010-kicker">Shared live meetup</span>
          <h2>What is actually happening?</h2>
          <p>Voluntary check-ins only. No GPS or background location.</p>
        </div>
        <span class="v010-sync" id="v010Sync">Connecting…</span>
      </div>
      <div class="v010-alert" id="v010Alert" hidden></div>
      <div class="v010-checkin" id="v010Checkin" hidden>
        <strong>Update my status</strong>
        <div class="v010-checkin-actions">
          <button type="button" data-v010-status="left">↗ Left</button>
          <button type="button" data-v010-status="on-vehicle">● On vehicle</button>
          <button type="button" data-v010-status="at-stop">⌖ At stop</button>
          <button type="button" data-v010-status="missed" class="warn">! Missed it</button>
          <button type="button" data-v010-status="arrived" class="good">✓ I'm here</button>
        </div>
        <div class="v010-checkin-foot"><small id="v010CheckinNote">Tap only what you want to share with this meetup.</small><button type="button" data-v010-status="clear" class="clear">Clear my check-in</button></div>
      </div>
      <div class="v010-status-list" id="v010StatusList"></div>
    `;
    const livePanel = document.getElementById("liveMeetupPanel");
    const resultsSection = document.querySelector(".results-section");
    if (livePanel) livePanel.insertAdjacentElement("afterend", panel);
    else if (resultsSection) resultsSection.insertAdjacentElement("beforebegin", panel);
    else document.querySelector("main.app")?.appendChild(panel);

    panel.querySelectorAll("[data-v010-status]").forEach((button) => {
      button.addEventListener("click", () => sendStatus(button.dataset.v010Status));
    });
    return panel;
  }

  function alertCopy(members, states) {
    const missed = states.filter((item) => item?.status === "missed");
    const arrived = states.filter((item) => item?.status === "arrived");
    if (missed.length) {
      const names = missed.map((item) => members[item.index]?.name || `Person ${item.index + 1}`);
      return { cls: "warn", text: `Replan suggested — ${names.join(" + ")} ${names.length === 1 ? "reported" : "reported"} a missed connection.` };
    }
    if (members.length && arrived.length === members.length) {
      return { cls: "good", text: "Everyone confirmed here 🎉" };
    }
    if (arrived.length) return { cls: "good", text: `${arrived.length}/${members.length} confirmed at the meetup.` };
    return null;
  }

  function render() {
    const panel = ensurePanel();
    if (!panel) return;
    const plan = sharedPlan();
    const members = Array.isArray(plan?.members) ? plan.members : [];
    const focus = focusIndex();
    const values = liveState?.members && typeof liveState.members === "object" ? liveState.members : {};
    const states = members.map((_, index) => ({ index, ...(values[String(index)] || {}) }));

    const sync = panel.querySelector("#v010Sync");
    if (sync) sync.textContent = liveState?.updatedAt ? `Synced ${ago(liveState.updatedAt)}` : "No check-ins yet";

    const checkin = panel.querySelector("#v010Checkin");
    if (checkin) checkin.hidden = focus < 0;
    panel.querySelectorAll("[data-v010-status]").forEach((button) => { button.disabled = sending; });

    const current = focus >= 0 ? values[String(focus)] : null;
    const note = panel.querySelector("#v010CheckinNote");
    if (note) {
      note.textContent = current?.status
        ? `Your latest check-in: ${STATUS_COPY[current.status]?.label || current.status}${current.note ? ` · ${current.note}` : ""} · ${ago(current.at)}`
        : "Tap only what you want to share with this meetup.";
    }

    const alert = panel.querySelector("#v010Alert");
    const alertData = alertCopy(members, states);
    if (alert) {
      alert.hidden = !alertData;
      alert.className = `v010-alert ${alertData?.cls || ""}`;
      alert.textContent = alertData?.text || "";
    }

    const list = panel.querySelector("#v010StatusList");
    if (list) {
      list.innerHTML = members.map((member, index) => {
        const state = values[String(index)] || null;
        const copy = state ? STATUS_COPY[state.status] : null;
        const manual = state && copy;
        const assignment = assignments()[index];
        const estimated = assignment ? window.NVSLiveMeetup?.routeState?.(assignment, new Date()) : null;
        const headline = manual ? `${copy.icon} ${copy.label}` : (estimated?.label || "Timetable only");
        const detail = manual
          ? `${state.note ? `${state.note} · ` : ""}confirmed ${ago(state.at)}`
          : `${estimated?.detail || "No voluntary check-in"}${estimated ? " · timetable estimate" : ""}`;
        return `
          <div class="v010-person ${manual ? `manual ${copy.tone}` : "estimated"}">
            <span class="v010-person-dot" style="background:${escapeHtml(member.color || "#667085")}"></span>
            <div><strong>${escapeHtml(member.name || `Person ${index + 1}`)}</strong><small>${escapeHtml(headline)}</small><em>${escapeHtml(detail)}</em></div>
            <span class="v010-source">${manual ? "CONFIRMED" : "TIMETABLE"}</span>
          </div>`;
      }).join("");
    }
  }

  function start() {
    if (!planId() || !sharedPlan()) return;
    ensurePanel();
    poll();
    clearInterval(timer);
    timer = setInterval(poll, POLL_MS);
    render();
  }

  window.addEventListener("nvs-group-recommendations-rendered", render);
  window.addEventListener("nvs-display-options-change", render);
  window.addEventListener("pageshow", () => { poll(); render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  window.addEventListener("load", start);

  window.NVSSharedLive = Object.freeze({
    getPlanId: planId,
    getState: () => liveState,
    refresh: poll,
    checkIn: sendStatus,
  });

  start();
})();
