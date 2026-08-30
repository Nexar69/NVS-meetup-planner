(() => {
  const POLL_MS = 12_000;
  const CAPABILITY_PREFIX = "meet-schwerin-checkin-capability:";
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
  let loadedRevision = null;
  let pendingRevision = null;
  let pollGeneration = 0;
  let pollTask = null;
  let sendGeneration = 0;
  let sendTask = null;

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

  function capabilityStorageKey() {
    const id = planId();
    return id ? `${CAPABILITY_PREFIX}${id}` : "";
  }

  function rememberCapability(value) {
    const key = String(value || "");
    const storageKey = capabilityStorageKey();
    if (key.length < 20 || !storageKey) return "";
    try { sessionStorage.setItem(storageKey, key); } catch {}
    return key;
  }

  function forgetCapability() {
    const storageKey = capabilityStorageKey();
    if (!storageKey) return;
    try { sessionStorage.removeItem(storageKey); } catch {}
  }

  function capabilityKey() {
    const fromUrl = new URLSearchParams(window.location.search).get("k") || "";
    if (fromUrl.length >= 20) return rememberCapability(fromUrl);
    const storageKey = capabilityStorageKey();
    if (!storageKey) return "";
    try { return sessionStorage.getItem(storageKey) || ""; } catch { return ""; }
  }

  function sanitizeCapabilityUrl() {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("k") || "";
    if (key.length < 20) return;
    rememberCapability(key);
    params.delete("k");
    const query = params.toString();
    const clean = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    try { window.history.replaceState(window.history.state, "", clean); } catch {}
  }

  function sharedPlan() {
    return window.NVSShare?.getSharedPlan?.() || null;
  }

  function focusIndex() {
    const value = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(value) ? value : -1;
  }

  function authoritativeExpiry() {
    const value = Number(liveState?.expiresAt);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function sessionExpired() {
    const expiry = authoritativeExpiry();
    return expiry != null && Date.now() >= expiry;
  }

  function canCheckIn() {
    return focusIndex() >= 0 && capabilityKey().length >= 20 && pendingRevision == null && !sessionExpired();
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

  function invalidatePoll() {
    pollGeneration += 1;
    const task = pollTask;
    pollTask = null;
    try { task?.controller?.abort(); } catch {}
  }

  function invalidateSend() {
    sendGeneration += 1;
    const task = sendTask;
    sendTask = null;
    sending = false;
    try { task?.controller?.abort(); } catch {}
  }

  function pollStillCurrent(task) {
    return pollTask === task
      && task.generation === pollGeneration
      && !document.hidden
      && !sending
      && planId() === task.planId;
  }

  function sendStillCurrent(task) {
    return sendTask === task
      && task.generation === sendGeneration
      && !document.hidden
      && pendingRevision == null
      && !sessionExpired()
      && planId() === task.planId
      && focusIndex() === task.focus;
  }

  function checkinOutcome(status, reason, extra = null) {
    const outcome = Object.freeze({
      ok: status === "sent",
      status,
      reason,
      ...(extra && typeof extra === "object" ? extra : {}),
    });
    try { window.dispatchEvent(new CustomEvent("nvs-shared-checkin-outcome", { detail: outcome })); } catch {}
    return outcome;
  }

  async function responseProblem(response) {
    try {
      const data = await response.json();
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  }

  async function sendStatus(status) {
    const url = apiUrl();
    const focus = focusIndex();
    const key = capabilityKey();
    if (!url || focus < 0 || !key) return checkinOutcome("blocked", "unavailable");
    if (sending) return checkinOutcome("blocked", "busy");
    if (pendingRevision != null) return checkinOutcome("rejected", "plan_updated", { revision: pendingRevision });
    if (sessionExpired()) return checkinOutcome("rejected", "expired", { expiresAt: authoritativeExpiry() });

    const generation = ++sendGeneration;
    const controller = new AbortController();
    const task = { generation, controller, planId: planId(), focus };
    sendTask = task;
    sending = true;
    invalidatePoll();
    render();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ member: focus, key, status, note: status === "clear" ? "" : suggestedNote(status), revision: loadedRevision }),
        signal: controller.signal,
      });
      if (!sendStillCurrent(task)) {
        if (sessionExpired()) return checkinOutcome("rejected", "expired", { expiresAt: authoritativeExpiry() });
        if (pendingRevision != null) return checkinOutcome("rejected", "plan_updated", { revision: pendingRevision });
        return checkinOutcome("aborted", "superseded");
      }
      if (!response.ok) {
        const problem = await responseProblem(response);
        if (!sendStillCurrent(task)) {
          if (sessionExpired()) return checkinOutcome("rejected", "expired", { expiresAt: authoritativeExpiry() });
          if (pendingRevision != null) return checkinOutcome("rejected", "plan_updated", { revision: pendingRevision });
          return checkinOutcome("aborted", "superseded");
        }
        if (response.status === 403) {
          forgetCapability();
          const note = document.getElementById("v010CheckinNote");
          if (note) note.textContent = "This private check-in link was reset by the organizer and is now read-only. Ask for a fresh personal link to check in again.";
          render();
          return checkinOutcome("rejected", "capability_revoked", { httpStatus: 403 });
        }
        if (response.status === 409 && problem?.error === "plan_updated") {
          const revision = Math.max(1, Number(problem?.revision) || 1);
          if (loadedRevision == null || revision > loadedRevision) pendingRevision = revision;
          const expiresAt = Number(problem?.expiresAt);
          if (Number.isFinite(expiresAt) && expiresAt > 0) liveState = { ...(liveState || {}), expiresAt };
          render();
          return checkinOutcome("rejected", "plan_updated", { httpStatus: 409, revision, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null });
        }
        if (sessionExpired()) return checkinOutcome("rejected", "expired", { httpStatus: response.status, expiresAt: authoritativeExpiry() });
        return checkinOutcome("rejected", "http_error", { httpStatus: response.status, error: String(problem?.error || "") });
      }
      const next = await response.json();
      if (!sendStillCurrent(task)) {
        if (sessionExpired()) return checkinOutcome("rejected", "expired", { expiresAt: authoritativeExpiry() });
        if (pendingRevision != null) return checkinOutcome("rejected", "plan_updated", { revision: pendingRevision });
        return checkinOutcome("aborted", "superseded");
      }
      liveState = { ...(liveState || {}), ...next };
      render();
      window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: liveState }));
      return checkinOutcome("sent", "confirmed", { httpStatus: response.status, updatedAt: Number(next?.updatedAt) || null });
    } catch (error) {
      if (error?.name === "AbortError") return checkinOutcome("aborted", "cancelled");
      console.warn("Shared check-in failed", error);
      const note = document.getElementById("v010CheckinNote");
      if (note) note.textContent = "Could not update the shared status. This link may be an older read-only link, or you may be offline.";
      return checkinOutcome("uncertain", "network_error");
    } finally {
      if (sendTask === task) {
        sendTask = null;
        sending = false;
        render();
        schedulePoll();
      }
    }
  }

  function poll() {
    const currentPlanId = planId();
    const url = apiUrl();
    if (!url || !currentPlanId || document.hidden || sending) return Promise.resolve();
    if (pollTask) return pollTask.promise;

    const generation = ++pollGeneration;
    const controller = new AbortController();
    const task = { generation, controller, planId: currentPlanId, promise: null };
    task.promise = (async () => {
      try {
        const response = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!response.ok || !pollStillCurrent(task)) return;
        const next = await response.json();
        if (!pollStillCurrent(task)) return;
        const revision = Math.max(1, Number(next?.revision) || 1);
        if (loadedRevision == null) loadedRevision = revision;
        else if (revision > loadedRevision) pendingRevision = revision;
        liveState = next;
        render();
        window.dispatchEvent(new CustomEvent("nvs-shared-live-change", { detail: liveState }));
      } catch (error) {
        if (error?.name !== "AbortError") {
          // Keep the most recent state visible while temporarily offline.
        }
      } finally {
        if (pollTask === task) pollTask = null;
      }
    })();
    pollTask = task;
    return task.promise;
  }

  function schedulePoll(delay = POLL_MS) {
    clearTimeout(timer);
    if (document.hidden || !planId()) return;
    timer = setTimeout(async () => {
      await poll();
      schedulePoll();
    }, delay);
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
      <div class="v010-plan-update" id="v010PlanUpdate" hidden>
        <div><strong>Plan updated</strong><small>The organizer changed this meetup. Reload to use the new route.</small></div>
        <button type="button" id="v010ReloadPlan">Reload updated plan</button>
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
    panel.querySelector("#v010ReloadPlan")?.addEventListener("click", () => window.location.reload());
    return panel;
  }

  function alertCopy(members, states) {
    const missed = states.filter((item) => item?.status === "missed");
    const arrived = states.filter((item) => item?.status === "arrived");
    if (missed.length) {
      const names = missed.map((item) => members[item.index]?.name || `Person ${item.index + 1}`);
      return { cls: "warn", text: `Replan suggested — ${names.join(" + ")} reported a missed connection.` };
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

    const updateBanner = panel.querySelector("#v010PlanUpdate");
    if (updateBanner) updateBanner.hidden = pendingRevision == null;

    const checkin = panel.querySelector("#v010Checkin");
    if (checkin) checkin.hidden = !canCheckIn();
    panel.querySelectorAll("[data-v010-status]").forEach((button) => { button.disabled = sending || pendingRevision != null || sessionExpired(); });

    const current = focus >= 0 ? values[String(focus)] : null;
    const note = panel.querySelector("#v010CheckinNote");
    if (note) {
      note.textContent = sessionExpired()
        ? "This shared session has expired. Ask the organizer for a new link to continue voluntary check-ins."
        : pendingRevision != null
          ? "Reload the updated plan before posting another check-in."
          : current?.status
            ? `Your latest check-in: ${STATUS_COPY[current.status]?.label || current.status}${current.note ? ` · ${current.note}` : ""} · ${ago(current.at)}`
            : canCheckIn()
              ? "Private check-in key is kept only in this tab after opening; it is hidden from the address bar."
              : "Tap only what you want to share with this meetup.";
    }

    let legacy = panel.querySelector(".v010-legacy-note");
    if (focus >= 0 && !canCheckIn() && pendingRevision == null && !sessionExpired()) {
      if (!legacy) {
        legacy = document.createElement("p");
        legacy.className = "v010-legacy-note";
        panel.querySelector("#v010StatusList")?.insertAdjacentElement("beforebegin", legacy);
      }
      legacy.textContent = "This personal link does not have a current check-in capability in this tab. It stays read-only; open a fresh private personal link from the organizer to enable voluntary check-ins.";
    } else {
      legacy?.remove();
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
    sanitizeCapabilityUrl();
    ensurePanel();
    invalidatePoll();
    void poll();
    schedulePoll();
    render();
  }

  window.addEventListener("nvs-group-recommendations-rendered", render);
  window.addEventListener("nvs-display-options-change", render);
  window.addEventListener("nvs-shared-session-expired", () => {
    invalidateSend();
    render();
  });
  window.addEventListener("pageshow", () => {
    invalidatePoll();
    void poll();
    schedulePoll();
    render();
  });
  window.addEventListener("pagehide", () => {
    clearTimeout(timer);
    invalidatePoll();
    invalidateSend();
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    invalidatePoll();
    if (document.hidden) invalidateSend();
    if (!document.hidden) {
      void poll();
      schedulePoll();
    }
  });
  window.addEventListener("online", () => {
    invalidatePoll();
    void poll();
    schedulePoll();
  });
  window.addEventListener("load", start);

  window.NVSSharedLive = Object.freeze({
    getPlanId: planId,
    getState: () => liveState,
    canCheckIn,
    hasPendingPlanUpdate: () => pendingRevision != null,
    refresh: poll,
    checkIn: sendStatus,
  });

  start();
})();