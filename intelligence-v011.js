(() => {
  const core = window.NVSIntelligenceCore;
  if (!core) return;

  const PREF_KEY = "meet-schwerin-intelligence-v1";
  const DEFAULT_PREFS = Object.freeze({
    leave: true,
    transfer: true,
    meetup: true,
    disruptions: true,
    stale: true,
    systemNotifications: false,
  });

  const results = document.getElementById("results");
  const resultsSection = document.querySelector(".results-section");
  const destinationInput = document.getElementById("destination");
  const connectionLabel = document.getElementById("connectionLabel");

  let prefs = { ...DEFAULT_PREFS };
  let tick = null;
  let renderTimer = null;
  let notified = new Map();
  let reloadingForUpdate = false;
  let updateRegistration = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function asDate(value) {
    return core.asDate(value);
  }

  function formatTime(value) {
    const date = asDate(value);
    return date ? new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date) : "—";
  }

  function recommendation() {
    return window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
  }

  function assignments(group = recommendation()) {
    return Array.isArray(group?.assignments) ? group.assignments.filter((item) => item?.member && item?.route) : [];
  }

  function focusIndex(group = recommendation()) {
    const shared = window.NVSShare?.getSharedPlan?.();
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    if (shared?.view === "person" && Number.isInteger(focus) && focus >= 0) return focus;
    return assignments(group).length ? 0 : -1;
  }

  function destinationLocation() {
    return window.NVSTransit?.LOCATIONS?.[destinationInput?.value] || null;
  }

  function convergence(group) {
    if (!group || !window.NVSConvergence?.analyze) return { events: [], memberEvents: {}, sharedLegs: [] };
    const destination = destinationLocation();
    return window.NVSConvergence.analyze(group, {
      destinationPoint: destination ? [destination.lat, destination.lon] : null,
      destinationLabel: destination?.label || destinationInput?.value || "Meetup",
    });
  }

  function sharedState() {
    return window.NVSSharedLive?.getState?.() || null;
  }

  function readPrefs() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      prefs = { ...DEFAULT_PREFS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch {
      prefs = { ...DEFAULT_PREFS };
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {}
  }

  function kindEnabled(item) {
    if (!item) return false;
    if (["disruption", "platform", "group-impact", "recovery"].includes(item.kind)) return prefs.disruptions;
    if (item.kind === "leave" || item.kind === "get-off") return prefs.leave;
    if (item.kind === "transfer") return prefs.transfer;
    if (item.kind === "meetup" || item.kind === "arrival") return prefs.meetup;
    if (item.kind === "stale-checkin") return prefs.stale;
    return true;
  }

  function collectAlerts(now = new Date()) {
    const group = recommendation();
    const list = assignments(group);
    if (!group || !list.length) return [];
    const analysis = convergence(group);
    const focus = focusIndex(group);
    const focusAssignment = list[focus] || list[0];
    const all = [];

    all.push(...core.routeAlerts(focusAssignment, now));
    all.push(...core.meetupAlerts(analysis.events, focusAssignment?.member?.id, now));

    list.forEach((assignment, index) => {
      if (index === focus) return;
      core.routeAlerts(assignment, now)
        .filter((item) => ["critical", "warn"].includes(item.severity))
        .forEach((item) => all.push({ ...item, title: `${assignment.member.name}: ${item.title}` }));
    });

    all.push(...core.sharedAlerts(sharedState(), list.map((item) => item.member), now));
    all.push(...core.groupImpactAlerts(list, analysis.events, sharedState(), now));

    const unique = new Map();
    core.rankAlerts(all).forEach((item) => {
      if (kindEnabled(item) && !unique.has(item.id)) unique.set(item.id, item);
    });
    return [...unique.values()];
  }

  function severityIcon(severity) {
    return { critical: "!", warn: "!", action: "→", info: "i", good: "✓" }[severity] || "i";
  }

  function providerSummary() {
    const status = window.NVSTransit?.getProviderStatus?.() || {};
    const provider = String(status.provider || "Routing");
    const fallback = Boolean(status.fallback);
    if (!navigator.onLine) return { label: "Offline", cls: "offline" };
    return { label: fallback ? `${provider} fallback` : provider, cls: fallback ? "warn" : "good" };
  }

  function currentState(now = new Date()) {
    const group = recommendation();
    const list = assignments(group);
    const focus = focusIndex(group);
    const assignment = list[focus] || list[0];
    return assignment ? window.NVSLiveMeetup?.routeState?.(assignment, now) || null : null;
  }

  function nextInstruction(assignment, state) {
    if (!assignment || !state) return null;
    const segments = assignment.route?.segments || [];
    const index = Number.isInteger(state.nextIndex) ? state.nextIndex : -1;
    if (index < 0 || !segments[index]) return null;
    return window.NVSInstructions?.instructionFor?.(segments[index]) || {
      title: `${segments[index].modeLabel || segments[index].mode || "Journey"} → ${segments[index].to || "next stop"}`,
      detail: segments[index].headsign ? `toward ${segments[index].headsign}` : "",
    };
  }

  function ensurePanel() {
    let panel = document.getElementById("v011CommandCenter");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "v011CommandCenter";
    panel.className = "v011-command";
    panel.setAttribute("aria-labelledby", "v011CommandTitle");
    panel.innerHTML = `
      <div class="v011-command-head">
        <div>
          <span class="v011-kicker">Meetup intelligence</span>
          <h2 id="v011CommandTitle">Journey command center</h2>
          <p>Current action, disruptions and group impact in one place.</p>
        </div>
        <div class="v011-command-actions">
          <button type="button" id="v011TripModeButton" class="v011-button primary">Trip mode</button>
          <button type="button" id="v011AlertSettingsButton" class="v011-button">Alerts</button>
        </div>
      </div>
      <div class="v011-primary" id="v011PrimaryAlert"></div>
      <div class="v011-mini-grid">
        <div class="v011-mini" id="v011CurrentAction"></div>
        <div class="v011-mini" id="v011GroupImpact"></div>
      </div>
      <div class="v011-command-foot">
        <div class="v011-diagnostics" id="v011Diagnostics"></div>
        <button type="button" class="v011-replan" id="v011Replan">Refresh & replan</button>
      </div>`;

    const livePanel = document.getElementById("liveMeetupPanel");
    if (livePanel) livePanel.insertAdjacentElement("beforebegin", panel);
    else if (resultsSection) resultsSection.insertAdjacentElement("beforebegin", panel);
    else document.querySelector("main.app")?.appendChild(panel);

    panel.querySelector("#v011TripModeButton")?.addEventListener("click", openTripMode);
    panel.querySelector("#v011AlertSettingsButton")?.addEventListener("click", openSettings);
    panel.querySelector("#v011Replan")?.addEventListener("click", replan);
    return panel;
  }

  function ensureTripDialog() {
    let dialog = document.getElementById("v011TripDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "v011TripDialog";
    dialog.className = "v011-trip-dialog";
    dialog.innerHTML = `
      <div class="v011-trip-shell">
        <div class="v011-trip-top">
          <div><span class="v011-kicker">Trip mode</span><strong id="v011TripPerson">Your journey</strong></div>
          <button type="button" class="v011-trip-close" aria-label="Close trip mode">×</button>
        </div>
        <div class="v011-trip-alert" id="v011TripAlert"></div>
        <div class="v011-trip-action">
          <span id="v011TripPill">LIVE</span>
          <h2 id="v011TripAction">Preparing journey…</h2>
          <p id="v011TripDetail"></p>
        </div>
        <div class="v011-trip-progress"><span id="v011TripProgress"></span></div>
        <div class="v011-trip-next" id="v011TripNext"></div>
        <div class="v011-trip-group" id="v011TripGroup"></div>
        <div class="v011-trip-buttons">
          <button type="button" class="v011-button" id="v011TripSettings">Alert settings</button>
          <button type="button" class="v011-button primary" id="v011TripReplan">Refresh & replan</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".v011-trip-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector("#v011TripSettings")?.addEventListener("click", openSettings);
    dialog.querySelector("#v011TripReplan")?.addEventListener("click", replan);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  function ensureSettingsDialog() {
    let dialog = document.getElementById("v011SettingsDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "v011SettingsDialog";
    dialog.className = "v011-settings-dialog";
    dialog.innerHTML = `
      <div class="v011-settings-shell">
        <div class="v011-settings-head"><div><span class="v011-kicker">Alerts</span><h2>Travel alert settings</h2></div><button type="button" class="v011-settings-close" aria-label="Close">×</button></div>
        <p class="v011-settings-copy">Choose what Meet Schwerin should surface. System notifications are optional and only requested when you turn them on.</p>
        <div class="v011-settings-list">
          ${settingRow("leave", "Leave & get-off alerts", "Tell me when to start and when my stop is coming up.")}
          ${settingRow("transfer", "Transfer alerts", "Warn about the next connection and tight transfers.")}
          ${settingRow("meetup", "Meetup alerts", "Surface upcoming ★ joins and group arrival progress.")}
          ${settingRow("disruptions", "Disruptions & group impact", "Show delays, cancellations, platform changes and recovery warnings.")}
          ${settingRow("stale", "Stale check-in warnings", "Stop old voluntary statuses from looking current.")}
          ${settingRow("systemNotifications", "System notifications", "Show selected urgent alerts outside the page while the app is running.")}
        </div>
        <p class="v011-settings-note" id="v011NotificationNote"></p>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".v011-settings-close")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll("[data-v011-pref]").forEach((button) => {
      button.addEventListener("click", () => togglePreference(button.dataset.v011Pref));
    });
    return dialog;
  }

  function settingRow(key, title, detail) {
    return `<button type="button" class="v011-setting" data-v011-pref="${key}"><span><strong>${title}</strong><small>${detail}</small></span><em data-v011-state="${key}">On</em></button>`;
  }

  async function togglePreference(key) {
    if (!(key in prefs)) return;
    if (key === "systemNotifications" && !prefs[key]) {
      if (!("Notification" in window)) {
        const note = document.getElementById("v011NotificationNote");
        if (note) note.textContent = "This browser does not support system notifications.";
        return;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          prefs.systemNotifications = false;
          savePrefs();
          renderSettings();
          const note = document.getElementById("v011NotificationNote");
          if (note) note.textContent = "Notification permission was not granted. In-app alerts still work normally.";
          return;
        }
      }
    }
    prefs[key] = !prefs[key];
    savePrefs();
    renderSettings();
    scheduleRender();
  }

  function renderSettings() {
    const dialog = ensureSettingsDialog();
    Object.entries(prefs).forEach(([key, value]) => {
      const button = dialog.querySelector(`[data-v011-pref="${key}"]`);
      const state = dialog.querySelector(`[data-v011-state="${key}"]`);
      button?.classList.toggle("active", Boolean(value));
      if (button) button.setAttribute("aria-pressed", String(Boolean(value)));
      if (state) state.textContent = value ? "On" : "Off";
    });
    const note = dialog.querySelector("#v011NotificationNote");
    if (note && !note.textContent) {
      note.textContent = prefs.systemNotifications
        ? "System alerts are enabled while Meet Schwerin is running."
        : "No notification permission is requested unless you enable system notifications.";
    }
  }

  function openSettings() {
    renderSettings();
    const dialog = ensureSettingsDialog();
    if (!dialog.open) dialog.showModal();
  }

  function openTripMode() {
    const dialog = ensureTripDialog();
    renderTripMode();
    if (!dialog.open) dialog.showModal();
  }

  function replan() {
    if (window.NVSLiveMeetup?.refresh) {
      window.NVSLiveMeetup.refresh();
      return;
    }
    document.getElementById("plannerForm")?.requestSubmit?.();
  }

  function renderPrimary(container, item) {
    if (!container) return;
    if (!item) {
      container.className = "v011-primary good";
      container.innerHTML = `<span class="v011-alert-icon">✓</span><div><strong>Meetup looks on track</strong><small>No urgent action or disruption is detected right now.</small></div>`;
      return;
    }
    container.className = `v011-primary ${item.severity || "info"}`;
    container.innerHTML = `<span class="v011-alert-icon">${escapeHtml(severityIcon(item.severity))}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail || "")}</small></div>${item.replan ? '<button type="button" class="v011-inline-replan">Replan</button>' : ""}`;
    container.querySelector(".v011-inline-replan")?.addEventListener("click", replan);
  }

  function freshCheckinCount(now = new Date()) {
    const group = recommendation();
    const list = assignments(group);
    const state = sharedState();
    const values = state?.members && typeof state.members === "object" ? state.members : {};
    let fresh = 0;
    Object.values(values).forEach((entry) => {
      if (core.checkinFreshness(entry, now).fresh) fresh += 1;
    });
    return { fresh, total: list.length };
  }

  function render() {
    const panel = ensurePanel();
    const group = recommendation();
    const list = assignments(group);
    if (!panel || !group || !list.length) {
      panel?.classList.remove("visible");
      return;
    }
    panel.classList.add("visible");

    const now = new Date();
    const alerts = collectAlerts(now);
    const primary = core.primaryAlert(alerts);
    renderPrimary(panel.querySelector("#v011PrimaryAlert"), primary);

    const focus = focusIndex(group);
    const assignment = list[focus] || list[0];
    const state = window.NVSLiveMeetup?.routeState?.(assignment, now) || null;
    const current = panel.querySelector("#v011CurrentAction");
    if (current) {
      current.innerHTML = `<span>NOW</span><strong>${escapeHtml(state?.label || "Journey ready")}</strong><small>${escapeHtml(state?.detail || `Planned arrival ${formatTime(assignment.route.arrival)}`)}</small>`;
    }

    const impact = panel.querySelector("#v011GroupImpact");
    if (impact) {
      const severe = alerts.filter((item) => ["critical", "warn"].includes(item.severity));
      const checkins = freshCheckinCount(now);
      impact.innerHTML = `<span>GROUP</span><strong>${severe.length ? `${severe.length} issue${severe.length === 1 ? "" : "s"} to watch` : "No group conflict detected"}</strong><small>${checkins.fresh ? `${checkins.fresh}/${checkins.total} fresh voluntary check-in${checkins.fresh === 1 ? "" : "s"}` : "Timetable estimates active"}</small>`;
    }

    const provider = providerSummary();
    const diagnostics = panel.querySelector("#v011Diagnostics");
    if (diagnostics) {
      diagnostics.innerHTML = `<span class="${provider.cls}">● ${escapeHtml(provider.label)}</span><span>${navigator.onLine ? "Online" : "Offline cache"}</span><span>${window.NVSShare?.isViewer?.() ? "Shared view" : "Planner"}</span>`;
    }

    renderTripMode(now, alerts);
    maybeNotify(primary);
  }

  function renderTripMode(now = new Date(), alerts = collectAlerts(now)) {
    const dialog = document.getElementById("v011TripDialog");
    if (!dialog) return;
    const group = recommendation();
    const list = assignments(group);
    if (!group || !list.length) return;
    const focus = focusIndex(group);
    const assignment = list[focus] || list[0];
    const state = window.NVSLiveMeetup?.routeState?.(assignment, now) || null;
    const primary = core.primaryAlert(alerts);
    const next = nextInstruction(assignment, state);

    const person = dialog.querySelector("#v011TripPerson");
    if (person) person.textContent = assignment.member?.name ? `${assignment.member.name}'s journey` : "Your journey";

    const alertBox = dialog.querySelector("#v011TripAlert");
    if (alertBox) {
      alertBox.className = `v011-trip-alert ${primary?.severity || "good"}`;
      alertBox.innerHTML = primary
        ? `<strong>${escapeHtml(primary.title)}</strong><small>${escapeHtml(primary.detail || "")}</small>`
        : `<strong>On track</strong><small>No urgent alert right now.</small>`;
    }

    const pill = dialog.querySelector("#v011TripPill");
    if (pill) pill.textContent = state?.phase === "arrived" ? "ARRIVED" : state?.phase === "waiting" ? "UP NEXT" : "LIVE";
    const action = dialog.querySelector("#v011TripAction");
    const detail = dialog.querySelector("#v011TripDetail");
    if (action) action.textContent = state?.label || "Journey ready";
    if (detail) detail.textContent = state?.detail || `Expected arrival ${formatTime(assignment.route.arrival)}`;

    const progress = dialog.querySelector("#v011TripProgress");
    if (progress) progress.style.width = `${Math.round(Math.max(0, Math.min(1, Number(state?.progress) || 0)) * 100)}%`;

    const nextBox = dialog.querySelector("#v011TripNext");
    if (nextBox) {
      nextBox.innerHTML = next
        ? `<span>NEXT</span><strong>${escapeHtml(next.title || "Next step")}</strong><small>${escapeHtml(next.detail || state?.nextDetail || "")}</small>`
        : `<span>NEXT</span><strong>${state?.phase === "arrived" ? "Meetup complete" : "Continue to the destination"}</strong><small>${state?.phase === "arrived" ? "You have reached the planned destination." : `Expected arrival ${formatTime(assignment.route.arrival)}`}</small>`;
    }

    const groupBox = dialog.querySelector("#v011TripGroup");
    if (groupBox) {
      const shared = sharedState()?.members || {};
      groupBox.innerHTML = list.map((item, index) => {
        const routeState = window.NVSLiveMeetup?.routeState?.(item, now);
        const manual = shared[String(index)];
        const freshness = manual ? core.checkinFreshness(manual, now) : null;
        const manualLabel = manual && freshness?.fresh ? manual.status : null;
        const status = manualLabel ? `Confirmed: ${manualLabel.replaceAll("-", " ")}` : (routeState?.label || "Timetable");
        return `<span class="v011-trip-member"><i style="background:${escapeHtml(item.member.color || "#667085")}"></i><b>${escapeHtml(item.member.name)}</b><em>${escapeHtml(status)}</em></span>`;
      }).join("");
    }
  }

  function maybeNotify(item) {
    if (!prefs.systemNotifications || !item || !("Notification" in window) || Notification.permission !== "granted") return;
    if (!["critical", "warn", "action"].includes(item.severity)) return;
    const previous = notified.get(item.id) || 0;
    if (Date.now() - previous < 120_000) return;
    notified.set(item.id, Date.now());
    try {
      new Notification(item.title, {
        body: item.detail || "Meet Schwerin travel alert",
        icon: "./icons/icon-192.png",
        tag: `meet-schwerin-${item.id}`,
        renotify: false,
      });
    } catch {}
    if (notified.size > 80) {
      notified = new Map([...notified.entries()].slice(-40));
    }
  }

  function ensureUpdateBanner() {
    let banner = document.getElementById("v011UpdateBanner");
    if (banner) return banner;
    banner = document.createElement("div");
    banner.id = "v011UpdateBanner";
    banner.className = "v011-update-banner";
    banner.hidden = true;
    banner.innerHTML = `<div><strong>Meet Schwerin update ready</strong><small>A newer app shell has finished downloading.</small></div><button type="button">Reload update</button>`;
    document.body.appendChild(banner);
    banner.querySelector("button")?.addEventListener("click", () => applyUpdate());
    return banner;
  }

  function showUpdate(registration) {
    updateRegistration = registration || updateRegistration;
    const banner = ensureUpdateBanner();
    banner.hidden = false;
  }

  function applyUpdate() {
    const worker = updateRegistration?.waiting;
    if (worker) {
      worker.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  }

  async function installUpdateWatcher() {
    if (!("serviceWorker" in navigator)) return;
    ensureUpdateBanner();
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) return;
      updateRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) showUpdate(registration);
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingForUpdate) return;
        reloadingForUpdate = true;
        window.location.reload();
      });
    } catch {}
  }

  function fixBrandIcon() {
    const mark = document.querySelector(".brand-mark");
    if (!mark) return;
    mark.classList.add("v011-brand-icon");
    mark.querySelectorAll(".brand-node").forEach((node) => { node.hidden = true; });
  }

  function scheduleRender(delay = 20) {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, delay);
  }

  function start() {
    readPrefs();
    fixBrandIcon();
    ensurePanel();
    ensureTripDialog();
    ensureSettingsDialog();
    ensureUpdateBanner();
    renderSettings();
    render();
    clearInterval(tick);
    tick = setInterval(render, 1_000);
    installUpdateWatcher();
  }

  [
    "nvs-group-recommendations-rendered",
    "nvs-routing-provider",
    "nvs-shared-live-change",
    "nvs-group-change",
    "nvs-priority-change",
    "nvs-timing-change",
    "online",
    "offline",
  ].forEach((name) => window.addEventListener(name, () => scheduleRender()));

  document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRender(); });
  window.addEventListener("pageshow", () => scheduleRender());
  window.addEventListener("load", start);
  if (results) new MutationObserver(() => scheduleRender(40)).observe(results, { childList: true, subtree: true });
  if (connectionLabel) new MutationObserver(() => scheduleRender(20)).observe(connectionLabel, { childList: true, characterData: true, subtree: true });

  window.NVSIntelligence = Object.freeze({
    getPreferences: () => ({ ...prefs }),
    getAlerts: () => collectAlerts(new Date()),
    openTripMode,
    openSettings,
    replan,
    refresh: scheduleRender,
  });

  start();
})();
