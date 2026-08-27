(() => {
  const STORAGE_KEY = "meet-schwerin-test-lab-v011";
  const CACHE_LABEL = "meet-schwerin-v0.11.0-r1";
  const RealDate = window.Date;
  const realFetch = window.fetch.bind(window);
  const STATUS_COPY = {
    none: "Timetable only",
    left: "Left",
    "on-vehicle": "On vehicle",
    "at-stop": "At stop",
    missed: "Missed it",
    arrived: "I'm here",
  };

  let state = loadState();
  let tickTimer = null;
  let versionTapCount = 0;
  let versionTapTimer = null;
  let fetchInstalled = false;
  let dateInstalled = false;
  let routeSnapshots = new WeakMap();
  let groupSnapshot = null;
  let lastFetch = { label: "None yet", at: null, ms: null, outcome: "—" };

  function defaultState() {
    return {
      enabled: false,
      virtualMs: RealDate.now(),
      savedAt: RealDate.now(),
      speed: 1,
      network: "normal",
      memberStates: {},
      memberDelays: {},
      selectedMember: 0,
    };
  }

  function loadState() {
    const fallback = defaultState();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const merged = { ...fallback, ...parsed };
      merged.memberStates = parsed?.memberStates && typeof parsed.memberStates === "object" ? parsed.memberStates : {};
      merged.memberDelays = parsed?.memberDelays && typeof parsed.memberDelays === "object" ? parsed.memberDelays : {};
      if (merged.enabled && Number(merged.speed) > 0 && Number.isFinite(Number(merged.savedAt))) {
        merged.virtualMs = Number(merged.virtualMs) + Math.max(0, RealDate.now() - Number(merged.savedAt)) * Number(merged.speed);
      }
      merged.savedAt = RealDate.now();
      return merged;
    } catch {
      return fallback;
    }
  }

  function saveState() {
    try {
      const snapshot = { ...state, virtualMs: virtualNowMs(), savedAt: RealDate.now() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {}
  }

  function virtualNowMs() {
    if (!state.enabled) return RealDate.now();
    const speed = Number(state.speed) || 0;
    const elapsed = Math.max(0, RealDate.now() - Number(state.savedAt || RealDate.now()));
    return Number(state.virtualMs || RealDate.now()) + elapsed * speed;
  }

  function rebaseClock(nextMs = virtualNowMs()) {
    state.virtualMs = Number(nextMs);
    state.savedAt = RealDate.now();
    saveState();
  }

  function installDateShim() {
    if (dateInstalled) return;
    class TestDate extends RealDate {
      constructor(...args) {
        if (args.length === 0 && state.enabled) super(virtualNowMs());
        else super(...args);
      }
      static now() {
        return state.enabled ? virtualNowMs() : RealDate.now();
      }
    }
    window.Date = TestDate;
    dateInstalled = true;
  }

  function restoreDateShim() {
    if (!dateInstalled) return;
    window.Date = RealDate;
    dateInstalled = false;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function requestUrl(input) {
    if (typeof input === "string") return input;
    if (input?.url) return input.url;
    try { return String(input); } catch { return ""; }
  }

  function isLiveApi(url) {
    return /\/api\/live\/[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12}/.test(url);
  }

  function isVmv(url) {
    return url.includes("/api/vmv/plan") || url.includes("fahrplanauskunft-mv.de") || url.includes("vmv.transport.rest");
  }

  function isTransitous(url) {
    return url.includes("api.transitous.org") || url.includes("/api/v6/plan");
  }

  function syntheticLiveState() {
    const members = {};
    Object.entries(state.memberStates || {}).forEach(([index, value]) => {
      if (!value || value.status === "none") return;
      members[String(index)] = {
        status: value.status,
        note: String(value.note || STATUS_COPY[value.status] || "Simulated").slice(0, 80),
        at: Number(value.at) || RealDate.now(),
        test: true,
      };
    });
    return {
      ok: true,
      testMode: true,
      planId: planId() || "test-plan",
      memberCount: assignments().length || sharedMembers().length,
      revision: Number(window.__NVS_SHORT_PLAN_REVISION__ || 1),
      updatedAt: RealDate.now(),
      members,
    };
  }

  async function testFetch(input, init = undefined) {
    const started = performance.now();
    const url = requestUrl(input);
    const method = String(init?.method || input?.method || "GET").toUpperCase();
    const label = isLiveApi(url) ? "Shared live" : isVmv(url) ? "VMV" : isTransitous(url) ? "Transitous" : "Other";

    if (state.enabled && isLiveApi(url)) {
      if (method === "POST") {
        try {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
          const member = Number(body.member);
          if (Number.isInteger(member) && member >= 0) {
            if (body.status === "clear") delete state.memberStates[String(member)];
            else state.memberStates[String(member)] = {
              status: String(body.status || "none"),
              note: String(body.note || STATUS_COPY[body.status] || "Simulated").slice(0, 80),
              at: RealDate.now(),
            };
            saveState();
            dispatchState();
          }
        } catch {}
      }
      const data = syntheticLiveState();
      lastFetch = { label, at: RealDate.now(), ms: Math.round(performance.now() - started), outcome: "SIMULATED" };
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    if (state.enabled) {
      const mode = state.network;
      const failVmv = (mode === "vmv-fail" || mode === "all-fail" || mode === "offline") && isVmv(url);
      const failTransit = (mode === "transit-fail" || mode === "all-fail" || mode === "offline") && isTransitous(url);
      const failOther = mode === "offline" && (/\/api\//.test(url) || /^https?:/.test(url));
      if (failVmv || failTransit || failOther) {
        lastFetch = { label, at: RealDate.now(), ms: Math.round(performance.now() - started), outcome: "TEST FAILURE" };
        throw new TypeError(`TEST_MODE_${mode.toUpperCase().replaceAll("-", "_")}`);
      }
      if (mode === "slow-2") await sleep(2000);
      if (mode === "slow-5") await sleep(5000);
    }

    try {
      const response = await realFetch(input, init);
      lastFetch = { label, at: RealDate.now(), ms: Math.round(performance.now() - started), outcome: `${response.status}` };
      renderDiagnostics();
      return response;
    } catch (error) {
      lastFetch = { label, at: RealDate.now(), ms: Math.round(performance.now() - started), outcome: "ERROR" };
      renderDiagnostics();
      throw error;
    }
  }

  function installFetchShim() {
    if (fetchInstalled) return;
    window.fetch = testFetch;
    fetchInstalled = true;
  }

  function restoreFetchShim() {
    if (!fetchInstalled) return;
    window.fetch = realFetch;
    fetchInstalled = false;
  }

  function recommendation() {
    return window.__NVS_LAST_RECOMMENDATIONS__?.primary || null;
  }

  function assignments() {
    const value = recommendation()?.assignments;
    return Array.isArray(value) ? value : [];
  }

  function sharedMembers() {
    const value = window.NVSShare?.getSharedPlan?.()?.members;
    return Array.isArray(value) ? value : [];
  }

  function members() {
    const routeMembers = assignments().map((assignment) => assignment?.member).filter(Boolean);
    return routeMembers.length ? routeMembers : sharedMembers();
  }

  function asRealDate(value) {
    const date = value instanceof RealDate ? value : new RealDate(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function shiftIso(value, minutes) {
    const date = asRealDate(value);
    return date ? new RealDate(date.getTime() + minutes * 60_000).toISOString() : value;
  }

  function restoreRoute(route) {
    const snapshot = routeSnapshots.get(route);
    if (!snapshot) return;
    route.departure = snapshot.departure;
    route.arrival = snapshot.arrival;
    snapshot.segments.forEach((saved, index) => {
      const segment = route.segments?.[index];
      if (!segment) return;
      segment.departure = saved.departure;
      segment.arrival = saved.arrival;
    });
  }

  function restoreAllDelays() {
    assignments().forEach((assignment) => restoreRoute(assignment?.route));
    const group = recommendation();
    if (group && groupSnapshot?.group === group) {
      group.latestArrival = groupSnapshot.latestArrival;
      group.earliestDeparture = groupSnapshot.earliestDeparture;
    }
  }

  function applyDelays() {
    const group = recommendation();
    if (!group) return;
    if (!groupSnapshot || groupSnapshot.group !== group) {
      groupSnapshot = { group, latestArrival: group.latestArrival, earliestDeparture: group.earliestDeparture };
    }

    assignments().forEach((assignment, index) => {
      const route = assignment?.route;
      if (!route) return;
      if (!routeSnapshots.has(route)) {
        routeSnapshots.set(route, {
          departure: route.departure,
          arrival: route.arrival,
          segments: (route.segments || []).map((segment) => ({ departure: segment.departure, arrival: segment.arrival })),
        });
      }
      restoreRoute(route);
      const minutes = Math.max(-30, Math.min(120, Number(state.memberDelays[String(index)] || 0)));
      if (!minutes) return;
      route.departure = shiftIso(route.departure, minutes);
      route.arrival = shiftIso(route.arrival, minutes);
      (route.segments || []).forEach((segment) => {
        segment.departure = shiftIso(segment.departure, minutes);
        segment.arrival = shiftIso(segment.arrival, minutes);
      });
    });

    const times = assignments().flatMap((assignment) => [
      asRealDate(assignment?.route?.departure)?.getTime(),
      asRealDate(assignment?.route?.arrival)?.getTime(),
    ]).filter(Number.isFinite);
    const departures = assignments().map((assignment) => asRealDate(assignment?.route?.departure)?.getTime()).filter(Number.isFinite);
    const arrivals = assignments().map((assignment) => asRealDate(assignment?.route?.arrival)?.getTime()).filter(Number.isFinite);
    if (departures.length) group.earliestDeparture = new RealDate(Math.min(...departures)).toISOString();
    if (arrivals.length) group.latestArrival = new RealDate(Math.max(...arrivals)).toISOString();
    if (!times.length && groupSnapshot) {
      group.latestArrival = groupSnapshot.latestArrival;
      group.earliestDeparture = groupSnapshot.earliestDeparture;
    }
  }

  function planId() {
    const match = window.location.pathname.match(/^\/p\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12})\/?$/);
    return match?.[1] || "";
  }

  function viewerRole() {
    if (!window.NVSShare?.isViewer?.()) return "Planner";
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return focus >= 0 ? `Person ${focus + 1}` : "Group viewer";
  }

  function formatLocalInput(ms) {
    const date = new RealDate(ms);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function formatClock(ms, seconds = true) {
    const date = new RealDate(ms);
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined,
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(date);
  }

  function eventPoints() {
    const group = recommendation();
    if (!group) return [];
    const points = [];
    const push = (label, value, kind = "route") => {
      const date = asRealDate(value);
      if (!date) return;
      points.push({ label, ms: date.getTime(), kind });
    };

    assignments().forEach((assignment, memberIndex) => {
      const name = assignment?.member?.name || `P${memberIndex + 1}`;
      push(`${name} departs`, assignment?.route?.departure, "departure");
      (assignment?.route?.segments || []).forEach((segment, segmentIndex) => {
        if (segmentIndex > 0) push(`${name} next leg`, segment?.departure, "transfer");
      });
      push(`${name} arrives`, assignment?.route?.arrival, "arrival");
    });

    try {
      const destinationInput = document.getElementById("destination");
      const destination = window.NVSTransit?.LOCATIONS?.[destinationInput?.value];
      const analysis = window.NVSConvergence?.analyze?.(group, {
        destinationPoint: destination ? [destination.lat, destination.lon] : null,
        destinationLabel: destination?.label || destinationInput?.value || "Meetup",
      });
      (analysis?.events || []).forEach((event) => push(`★ ${event.title || event.label || "Meet"}`, event.time, "meet"));
    } catch {}

    const deduped = new Map();
    points.sort((a, b) => a.ms - b.ms).forEach((point) => {
      const key = `${Math.round(point.ms / 30000)}:${point.label}`;
      if (!deduped.has(key)) deduped.set(key, point);
    });
    return [...deduped.values()].slice(0, 18);
  }

  function dispatchState() {
    window.dispatchEvent(new CustomEvent("nvs-test-state-change", {
      detail: {
        enabled: state.enabled,
        now: virtualNowMs(),
        speed: state.speed,
        network: state.network,
        memberStates: state.memberStates,
        memberDelays: state.memberDelays,
      },
    }));
    render();
  }

  function setEnabled(value) {
    const next = Boolean(value);
    if (next === state.enabled) return;
    if (next) {
      state.virtualMs = RealDate.now();
      state.savedAt = RealDate.now();
      state.enabled = true;
      installDateShim();
      installFetchShim();
      applyDelays();
      document.documentElement.classList.add("nvs-test-mode");
    } else {
      rebaseClock();
      state.enabled = false;
      restoreAllDelays();
      restoreDateShim();
      restoreFetchShim();
      document.documentElement.classList.remove("nvs-test-mode");
    }
    saveState();
    dispatchState();
  }

  function setSpeed(speed) {
    rebaseClock();
    state.speed = Math.max(0, Math.min(120, Number(speed) || 0));
    state.savedAt = RealDate.now();
    saveState();
    dispatchState();
  }

  function setVirtualTime(ms) {
    if (!Number.isFinite(Number(ms))) return;
    rebaseClock(Number(ms));
    dispatchState();
  }

  function nudge(minutes) {
    setVirtualTime(virtualNowMs() + Number(minutes) * 60_000);
  }

  function ensureUi() {
    let banner = document.getElementById("v011TestBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "v011TestBanner";
      banner.className = "v011-banner";
      banner.innerHTML = `<strong>🧪 TEST MODE</strong><span id="v011BannerTime"></span><button type="button" id="v011OpenLab">Open Test Lab</button>`;
      document.body.prepend(banner);
      banner.querySelector("#v011OpenLab")?.addEventListener("click", () => {
        document.getElementById("v011TestLab")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    let panel = document.getElementById("v011TestLab");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "v011TestLab";
    panel.className = "v011-lab";
    panel.innerHTML = `
      <div class="v011-head">
        <div><span>Developer tools</span><h2>🧪 Test Lab</h2><p>Everything below is local simulation. Shared-live backend writes are blocked while Test Mode is active.</p></div>
        <div class="v011-head-actions"><button type="button" id="v011Reset">Reset simulation</button><button type="button" class="danger" id="v011Disable">Exit Test Mode</button></div>
      </div>
      <div class="v011-tabs" role="tablist" aria-label="Test Lab sections">
        <button type="button" class="active" data-v011-tab="clock">Clock</button>
        <button type="button" data-v011-tab="people">People</button>
        <button type="button" data-v011-tab="network">Network</button>
        <button type="button" data-v011-tab="diag">Diagnostics</button>
      </div>
      <div class="v011-pane active" data-v011-pane="clock">
        <div class="v011-clock-hero"><div><small>SIMULATED NOW</small><strong id="v011ClockNow">—</strong><em id="v011ClockReal">Real: —</em></div><span id="v011ClockSpeed">1×</span></div>
        <label class="v011-field"><span>Set simulated date & time</span><input id="v011DateTime" type="datetime-local" step="1"></label>
        <div class="v011-grid-buttons" id="v011Nudges">
          <button type="button" data-nudge="-15">−15m</button><button type="button" data-nudge="-5">−5m</button><button type="button" data-nudge="-1">−1m</button>
          <button type="button" data-nudge="1">+1m</button><button type="button" data-nudge="5">+5m</button><button type="button" data-nudge="15">+15m</button>
        </div>
        <label class="v011-field"><span>Time speed</span><select id="v011Speed"><option value="0">Paused</option><option value="1">1×</option><option value="5">5×</option><option value="30">30×</option><option value="60">60×</option></select></label>
        <div class="v011-events"><div class="v011-section-title"><strong>Jump to route event</strong><small>Generated from the current Best recommendation</small></div><div id="v011EventButtons" class="v011-event-buttons"></div><div id="v011ScrubberWrap"></div></div>
      </div>
      <div class="v011-pane" data-v011-pane="people">
        <div class="v011-section-title"><strong>Simulated people</strong><small>These states never reach Cloudflare KV.</small></div>
        <div id="v011People"></div>
      </div>
      <div class="v011-pane" data-v011-pane="network">
        <div class="v011-section-title"><strong>Provider / network faults</strong><small>Applied only while Test Mode is enabled.</small></div>
        <label class="v011-field"><span>Network scenario</span><select id="v011Network">
          <option value="normal">Normal</option><option value="slow-2">Slow data · +2s</option><option value="slow-5">Very slow · +5s</option>
          <option value="vmv-fail">VMV fails → test fallback</option><option value="transit-fail">Transitous fails</option><option value="all-fail">VMV + Transitous fail</option><option value="offline">Offline / API failure</option>
        </select></label>
        <div class="v011-network-note" id="v011NetworkNote"></div>
        <button type="button" class="v011-primary" id="v011TestReplan">Run Refresh & replan</button>
      </div>
      <div class="v011-pane" data-v011-pane="diag">
        <div class="v011-section-title"><strong>Diagnostics</strong><small>Useful when something behaves differently on a phone.</small></div>
        <div class="v011-diag" id="v011Diagnostics"></div>
        <button type="button" id="v011CopyDiagnostics">Copy diagnostics</button>
      </div>`;

    const hero = document.querySelector(".hero");
    if (hero) hero.insertAdjacentElement("afterend", panel);
    else document.querySelector("main.app")?.prepend(panel);

    panel.querySelectorAll("[data-v011-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        panel.querySelectorAll("[data-v011-tab]").forEach((item) => item.classList.toggle("active", item === button));
        panel.querySelectorAll("[data-v011-pane]").forEach((pane) => pane.classList.toggle("active", pane.dataset.v011Pane === button.dataset.v011Tab));
        if (button.dataset.v011Tab === "diag") renderDiagnostics();
      });
    });
    panel.querySelector("#v011Disable")?.addEventListener("click", () => setEnabled(false));
    panel.querySelector("#v011Reset")?.addEventListener("click", resetSimulation);
    panel.querySelector("#v011DateTime")?.addEventListener("change", (event) => {
      const value = new RealDate(event.target.value);
      if (!Number.isNaN(value.getTime())) setVirtualTime(value.getTime());
    });
    panel.querySelectorAll("[data-nudge]").forEach((button) => button.addEventListener("click", () => nudge(Number(button.dataset.nudge))));
    panel.querySelector("#v011Speed")?.addEventListener("change", (event) => setSpeed(Number(event.target.value)));
    panel.querySelector("#v011Network")?.addEventListener("change", (event) => {
      state.network = event.target.value;
      saveState();
      dispatchState();
    });
    panel.querySelector("#v011TestReplan")?.addEventListener("click", () => window.NVSLiveMeetup?.refresh?.());
    panel.querySelector("#v011CopyDiagnostics")?.addEventListener("click", copyDiagnostics);
    return panel;
  }

  function renderPeople() {
    const root = document.getElementById("v011People");
    if (!root) return;
    const list = members();
    if (!list.length) {
      root.innerHTML = `<p class="v011-empty">Find a route first. The simulator will create one row per person.</p>`;
      return;
    }
    root.innerHTML = list.map((member, index) => {
      const current = state.memberStates[String(index)]?.status || "none";
      const delay = Number(state.memberDelays[String(index)] || 0);
      return `<div class="v011-person" data-member="${index}">
        <div class="v011-person-title"><span style="background:${String(member.color || "#667085")}"></span><strong>${escapeHtml(member.name || `Person ${index + 1}`)}</strong><em>Person ${index + 1}</em></div>
        <label><span>Status</span><select data-person-status="${index}">${Object.entries(STATUS_COPY).map(([value, label]) => `<option value="${value}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></label>
        <label><span>Route delay</span><select data-person-delay="${index}">${[-10,-5,0,3,5,10,20,30,60].map((value) => `<option value="${value}"${value === delay ? " selected" : ""}>${value > 0 ? "+" : ""}${value} min</option>`).join("")}</select></label>
      </div>`;
    }).join("");

    root.querySelectorAll("[data-person-status]").forEach((select) => {
      select.addEventListener("change", () => {
        const index = select.dataset.personStatus;
        const status = select.value;
        if (status === "none") delete state.memberStates[index];
        else state.memberStates[index] = { status, note: `TEST · ${STATUS_COPY[status]}`, at: RealDate.now() };
        saveState();
        dispatchState();
      });
    });
    root.querySelectorAll("[data-person-delay]").forEach((select) => {
      select.addEventListener("change", () => {
        state.memberDelays[select.dataset.personDelay] = Number(select.value) || 0;
        restoreAllDelays();
        applyDelays();
        saveState();
        dispatchState();
      });
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function renderEvents() {
    const root = document.getElementById("v011EventButtons");
    const scrubberWrap = document.getElementById("v011ScrubberWrap");
    if (!root || !scrubberWrap) return;
    const points = eventPoints();
    if (!points.length) {
      root.innerHTML = `<span class="v011-empty">Find a route first.</span>`;
      scrubberWrap.innerHTML = "";
      return;
    }
    root.innerHTML = points.map((point, index) => `<button type="button" data-event-index="${index}"><span>${escapeHtml(point.label)}</span><small>${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new RealDate(point.ms))}</small></button>`).join("");
    root.querySelectorAll("[data-event-index]").forEach((button) => button.addEventListener("click", () => setVirtualTime(points[Number(button.dataset.eventIndex)].ms)));

    const min = points[0].ms - 10 * 60_000;
    const max = points[points.length - 1].ms + 10 * 60_000;
    const current = Math.max(min, Math.min(max, virtualNowMs()));
    scrubberWrap.innerHTML = `<label class="v011-scrubber"><span>Journey scrubber</span><input id="v011Scrubber" type="range" min="${min}" max="${max}" step="30000" value="${current}"><small id="v011ScrubberLabel">${formatClock(current, false)}</small></label>`;
    const scrubber = document.getElementById("v011Scrubber");
    scrubber?.addEventListener("input", () => {
      const value = Number(scrubber.value);
      const label = document.getElementById("v011ScrubberLabel");
      if (label) label.textContent = formatClock(value, false);
    });
    scrubber?.addEventListener("change", () => setVirtualTime(Number(scrubber.value)));
  }

  function diagnosticsText() {
    const provider = window.NVSTransit?.getProviderStatus?.() || {};
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    const capability = new URLSearchParams(window.location.search).get("k") || "";
    const live = window.NVSSharedLive?.getState?.() || {};
    return [
      `App: ${document.getElementById("versionLabel")?.textContent || "unknown"}`,
      `PWA cache target: ${CACHE_LABEL}`,
      `Test Mode: ${state.enabled ? "ON" : "OFF"}`,
      `Simulated time: ${formatClock(virtualNowMs())}`,
      `Real time: ${formatClock(RealDate.now())}`,
      `Speed: ${state.speed}x`,
      `Network scenario: ${state.network}`,
      `Provider: ${provider.provider || "unknown"}`,
      `Provider fallback: ${provider.fallback ? "yes" : "no"}`,
      `Plan ID: ${planId() || "none"}`,
      `Viewer: ${viewerRole()}`,
      `Focus: ${focus >= 0 ? focus + 1 : "group/planner"}`,
      `Capability key: ${capability ? "present" : "none"}`,
      `Plan revision: ${live.revision ?? window.__NVS_SHORT_PLAN_REVISION__ ?? "unknown"}`,
      `People: ${members().length}`,
      `Last fetch: ${lastFetch.label} · ${lastFetch.outcome} · ${lastFetch.ms ?? "—"}ms`,
      `Service worker: ${navigator.serviceWorker?.controller ? "controlled" : "not controlled"}`,
    ].join("\n");
  }

  function renderDiagnostics() {
    const root = document.getElementById("v011Diagnostics");
    if (!root) return;
    root.innerHTML = diagnosticsText().split("\n").map((line) => {
      const [key, ...rest] = line.split(": ");
      return `<div><span>${escapeHtml(key)}</span><strong>${escapeHtml(rest.join(": "))}</strong></div>`;
    }).join("");
  }

  async function copyDiagnostics() {
    const text = diagnosticsText();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else window.prompt("Copy diagnostics:", text);
    } catch {
      window.prompt("Copy diagnostics:", text);
    }
  }

  function networkCopy() {
    return {
      normal: "Real providers and normal timing.",
      "slow-2": "Adds 2 seconds to future fetches so loading states are easy to inspect.",
      "slow-5": "Adds 5 seconds to future fetches.",
      "vmv-fail": "VMV requests fail so the existing Transitous fallback path can be tested.",
      "transit-fail": "Transitous requests fail; useful after VMV succeeds or for fallback error handling.",
      "all-fail": "Both routing providers fail.",
      offline: "Future API/data fetches fail. Already-loaded UI remains available.",
    }[state.network] || "";
  }

  function render() {
    const panel = ensureUi();
    const banner = document.getElementById("v011TestBanner");
    const visible = Boolean(state.enabled);
    if (panel) panel.hidden = !visible;
    if (banner) banner.hidden = !visible;
    document.documentElement.classList.toggle("nvs-test-mode", visible);
    if (!visible) return;

    const now = virtualNowMs();
    const bannerTime = document.getElementById("v011BannerTime");
    if (bannerTime) bannerTime.textContent = `SIMULATED ${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new RealDate(now))} · ${state.speed}×`;
    const clock = document.getElementById("v011ClockNow");
    if (clock) clock.textContent = formatClock(now);
    const real = document.getElementById("v011ClockReal");
    if (real) real.textContent = `Real: ${formatClock(RealDate.now())}`;
    const speedLabel = document.getElementById("v011ClockSpeed");
    if (speedLabel) speedLabel.textContent = state.speed === 0 ? "PAUSED" : `${state.speed}×`;
    const datetime = document.getElementById("v011DateTime");
    if (datetime && document.activeElement !== datetime) datetime.value = formatLocalInput(now);
    const speed = document.getElementById("v011Speed");
    if (speed) speed.value = String(state.speed);
    const network = document.getElementById("v011Network");
    if (network) network.value = state.network;
    const networkNote = document.getElementById("v011NetworkNote");
    if (networkNote) networkNote.textContent = networkCopy();
    renderPeople();
    renderEvents();
    renderDiagnostics();
  }

  function resetSimulation() {
    restoreAllDelays();
    state.memberStates = {};
    state.memberDelays = {};
    state.network = "normal";
    state.speed = 1;
    state.virtualMs = RealDate.now();
    state.savedAt = RealDate.now();
    saveState();
    dispatchState();
  }

  function installVersionTapUnlock() {
    const attach = () => {
      const version = document.getElementById("versionLabel");
      if (!version || version.dataset.v011Unlock) return Boolean(version);
      version.dataset.v011Unlock = "1";
      version.addEventListener("click", () => {
        versionTapCount += 1;
        clearTimeout(versionTapTimer);
        versionTapTimer = setTimeout(() => { versionTapCount = 0; }, 2500);
        if (versionTapCount >= 5) {
          versionTapCount = 0;
          setEnabled(true);
          ensureUi();
          render();
        }
      });
      return true;
    };
    if (!attach()) {
      const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function boot() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("test") === "1") state.enabled = true;
    if (params.get("test") === "0") state.enabled = false;
    state.savedAt = RealDate.now();
    if (state.enabled) {
      installDateShim();
      installFetchShim();
      applyDelays();
    }
    saveState();
    ensureUi();
    installVersionTapUnlock();
    render();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!state.enabled) return;
      render();
      window.dispatchEvent(new CustomEvent("nvs-test-clock-tick", { detail: { now: virtualNowMs(), speed: state.speed } }));
    }, 1000);
  }

  window.addEventListener("nvs-group-recommendations-rendered", () => {
    restoreAllDelays();
    routeSnapshots = new WeakMap();
    groupSnapshot = null;
    if (state.enabled) applyDelays();
    render();
  });
  window.addEventListener("nvs-shared-live-change", render);
  window.addEventListener("pageshow", render);

  window.NVSTestLab = Object.freeze({
    isEnabled: () => state.enabled,
    now: () => new RealDate(virtualNowMs()),
    setEnabled,
    setTime: setVirtualTime,
    setSpeed,
    nudge,
    getState: () => ({ ...state, now: virtualNowMs() }),
    setMemberStatus: (index, status, note = "") => {
      if (status === "none" || !status) delete state.memberStates[String(index)];
      else state.memberStates[String(index)] = { status, note: String(note || `TEST · ${STATUS_COPY[status] || status}`).slice(0, 80), at: RealDate.now() };
      saveState();
      dispatchState();
    },
    reset: resetSimulation,
    diagnostics: diagnosticsText,
  });

  boot();
})();
