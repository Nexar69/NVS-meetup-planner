const APP_VERSION = "0.2.0";
const STORAGE_KEY = "nvs-meetup-planner-state-v2";

const plannerForm = document.getElementById("plannerForm");
const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const personAInput = document.getElementById("personA");
const personBInput = document.getElementById("personB");
const destinationInput = document.getElementById("destination");
const results = document.getElementById("results");
const summary = document.getElementById("summary");
const connectionPill = document.getElementById("connectionPill");
const connectionLabel = document.getElementById("connectionLabel");
const dataBadge = document.getElementById("dataBadge");
const dataBadgeLabel = document.getElementById("dataBadgeLabel");
const installButton = document.getElementById("installButton");
const installDialog = document.getElementById("installDialog");
const installInstructions = document.getElementById("installInstructions");
const dialogInstallButton = document.getElementById("dialogInstallButton");
const toast = document.getElementById("toast");
const mobileSearchButton = document.getElementById("mobileSearchButton");
const desktopSearchButton = plannerForm.querySelector(".desktop-search");

let deferredInstallPrompt = null;
let toastTimer = null;
let activeSearchId = 0;

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localTimeString(date = new Date()) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function roundUpToMinutes(date, interval = 5) {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const remainder = rounded.getMinutes() % interval;
  if (remainder) rounded.setMinutes(rounded.getMinutes() + interval - remainder);
  return rounded;
}

function addMinutes(date, value) {
  return new Date(date.getTime() + value * 60_000);
}

function minutesBetween(a, b) {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 60_000);
}

function signedMinutesBetween(date, target) {
  return Math.round((date.getTime() - target.getTime()) / 60_000);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(date);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function saveState() {
  const state = {
    personA: personAInput.value,
    personB: personBInput.value,
    destination: destinationInput.value,
    date: dateInput.value,
    time: timeInput.value,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be disabled. The planner still works without persistence.
  }
}

function optionExists(select, value) {
  return [...select.options].some((option) => option.value === value);
}

function loadState() {
  dateInput.value = localDateString();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    if (optionExists(personAInput, state.personA)) personAInput.value = state.personA;
    if (optionExists(personBInput, state.personB)) personBInput.value = state.personB;
    if (optionExists(destinationInput, state.destination)) destinationInput.value = state.destination;
    if (typeof state.date === "string" && state.date) dateInput.value = state.date;
    if (typeof state.time === "string" && state.time) timeInput.value = state.time;
  } catch {
    // Ignore malformed or unavailable saved state.
  }
}

function generateDemoRoutes(origin, destination, targetTime) {
  const baseDurations = {
    "Lankow-Siedlung": 27,
    "Hegelstraße": 18,
    "Dreescher Markt": 12,
    Marienplatz: 17,
    Hauptbahnhof: 20,
  };

  let duration = baseDurations[origin] ?? 20;
  if (destination === "Hauptbahnhof") duration += 4;
  if (destination === "Marienplatz") duration += 2;
  if (origin === destination) duration = 5;

  const arrivalOffsets = [-32, -21, -11, -3, 7, 17, 28];

  return arrivalOffsets.map((offset, index) => {
    const arrival = addMinutes(targetTime, offset);
    const departure = addMinutes(arrival, -duration);

    return {
      id: `${origin}-${destination}-demo-${index}`,
      origin,
      destination,
      departure,
      arrival,
      duration,
      description: origin === destination ? "Short walk" : "Demo public-transport route",
      transfers: 0,
      realtime: false,
      source: "demo",
    };
  });
}

function createPairs(routesA, routesB, target) {
  const pairs = [];

  for (const routeA of routesA) {
    for (const routeB of routesB) {
      const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
      const earliestArrival = routeA.arrival < routeB.arrival ? routeA.arrival : routeB.arrival;
      const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
      const targetDifference = signedMinutesBetween(latestArrival, target);

      const score = Math.abs(targetDifference) + waitingDifference * 1.8;

      pairs.push({
        routeA,
        routeB,
        latestArrival,
        earliestArrival,
        waitingDifference,
        targetDifference,
        score,
      });
    }
  }

  return pairs;
}

function scoreDirectionalPair(pair, target, direction) {
  const targetDistance = direction === "early"
    ? (target.getTime() - pair.latestArrival.getTime()) / 60_000
    : (pair.earliestArrival.getTime() - target.getTime()) / 60_000;

  return Math.max(0, targetDistance) + pair.waitingDifference * 1.5;
}

function chooseConnections(pairs, target) {
  if (!pairs.length) return { early: null, best: null, later: null };

  const best = [...pairs].sort((a, b) => a.score - b.score)[0];

  const early = pairs
    .filter((pair) => pair !== best && pair.latestArrival <= target)
    .sort(
      (a, b) =>
        scoreDirectionalPair(a, target, "early") -
        scoreDirectionalPair(b, target, "early"),
    )[0] || null;

  const later = pairs
    .filter((pair) => pair !== best && pair.earliestArrival >= target)
    .sort(
      (a, b) =>
        scoreDirectionalPair(a, target, "later") -
        scoreDirectionalPair(b, target, "later"),
    )[0] || null;

  return { early, best, later };
}

function routeMeta(route) {
  const items = [];
  if (Number.isFinite(route.transfers)) {
    items.push(route.transfers === 0 ? "Direct" : `${route.transfers} change${route.transfers === 1 ? "" : "s"}`);
  }
  if (route.realtime) items.push("Realtime");
  return items.join(" · ");
}

function renderPerson(name, route, personClass) {
  const meta = routeMeta(route);
  return `
    <div class="person">
      <div>
        <div class="person-topline">
          <div class="person-name">
            <span class="person-dot ${personClass}" aria-hidden="true"></span>
            ${escapeHtml(name)}
          </div>
          <span class="duration-chip">${route.duration} min</span>
        </div>

        <div class="main-time">
          ${formatTime(route.departure)} → ${formatTime(route.arrival)}
        </div>

        <div class="journey-description">
          ${escapeHtml(route.description)}
        </div>
        ${meta ? `<div class="route-meta">${escapeHtml(meta)}</div>` : ""}
      </div>
    </div>
  `;
}

function targetMessage(pair) {
  if (pair.targetDifference === 0) return "On time";
  if (pair.targetDifference < 0) return `${Math.abs(pair.targetDifference)} min early`;
  return `${pair.targetDifference} min late`;
}

function renderUnavailableCard(title, type, message) {
  return `
    <article class="result unavailable-result">
      <div class="result-header">
        <div>
          <div class="result-title">${escapeHtml(title)}</div>
          <div class="result-subtitle">${escapeHtml(message)}</div>
        </div>
        <span class="badge">${type === "early" ? "Early" : "Later"}</span>
      </div>
    </article>
  `;
}

function renderCard(title, pair, type) {
  if (!pair) {
    return renderUnavailableCard(
      title,
      type,
      type === "early"
        ? "No suitable earlier pair appeared in this search window."
        : "No suitable later pair appeared in this search window.",
    );
  }

  const labels = {
    early: "Early",
    best: "Best match",
    later: "Later",
  };

  return `
    <article class="result ${type === "best" ? "best" : ""}">
      <div class="result-header">
        <div>
          <div class="result-title">${escapeHtml(title)}</div>
          <div class="result-subtitle">Together around ${formatTime(pair.latestArrival)}</div>
        </div>

        <span class="badge ${type === "best" ? "best" : ""}">
          ${type === "best" ? "★ " : ""}${labels[type]}
        </span>
      </div>

      ${renderPerson("You", pair.routeA, "person-dot-you")}
      ${renderPerson("Friend", pair.routeB, "person-dot-friend")}

      <div class="meeting-info">
        <div class="metric">
          <span>Wait gap</span>
          <strong>${pair.waitingDifference} min</strong>
        </div>
        <div class="metric">
          <span>Target</span>
          <strong>${targetMessage(pair)}</strong>
        </div>
      </div>
    </article>
  `;
}

function renderLoading() {
  results.innerHTML = `
    <div class="loading-card" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <div>
        <strong>Checking real connections…</strong>
        <p>Comparing both routes around your target time.</p>
      </div>
    </div>
  `;
}

function renderNoRoutes(personA, personB, destination) {
  results.innerHTML = `
    <div class="loading-card no-routes-card">
      <span aria-hidden="true">⌁</span>
      <div>
        <strong>No usable connections found</strong>
        <p>Transitous did not return journeys for ${escapeHtml(personA)} and ${escapeHtml(personB)} to ${escapeHtml(destination)} in this time window. Try a different time.</p>
      </div>
    </div>
  `;
}

function setDataMode(mode) {
  dataBadge.classList.remove("live", "loading", "fallback", "offline");
  dataBadge.classList.add(mode);

  const labels = {
    live: "Live timetable",
    loading: "Checking live data…",
    fallback: "Demo fallback",
    offline: "Offline demo",
  };
  dataBadgeLabel.textContent = labels[mode] || "Timetable";
}

function setSearching(searching) {
  [mobileSearchButton, desktopSearchButton].forEach((button) => {
    button.disabled = searching;
    button.classList.toggle("is-loading", searching);
    const label = button.querySelector("span:first-child");
    if (label) label.textContent = searching ? "Checking routes…" : "Find connections";
  });
}

function getTargetDate() {
  if (!dateInput.value || !timeInput.value) return null;
  const target = new Date(`${dateInput.value}T${timeInput.value}`);
  return Number.isNaN(target.getTime()) ? null : target;
}

function updateSummary(personA, personB, destination, target, suffix = "") {
  summary.innerHTML = `
    <strong>${escapeHtml(personA)}</strong> + <strong>${escapeHtml(personB)}</strong>
    → ${escapeHtml(destination)} · ${formatShortDate(target)} at
    <strong>${formatTime(target)}</strong>${suffix}
  `;
}

function renderConnections(routesA, routesB, target) {
  const pairs = createPairs(routesA, routesB, target);
  const connections = chooseConnections(pairs, target);

  if (!connections.best) return false;

  results.innerHTML =
    renderCard("A little early", connections.early, "early") +
    renderCard("Closest together", connections.best, "best") +
    renderCard("A little later", connections.later, "later");

  return true;
}

function technicalFallback(personA, personB, destination, target, mode = "fallback") {
  const routesA = generateDemoRoutes(personA, destination, target);
  const routesB = generateDemoRoutes(personB, destination, target);
  setDataMode(mode);
  renderConnections(routesA, routesB, target);
  updateSummary(
    personA,
    personB,
    destination,
    target,
    ` <span class="summary-note">· ${mode === "offline" ? "offline demo" : "demo fallback"}</span>`,
  );
}

async function search({ scrollToResults = false } = {}) {
  const searchId = ++activeSearchId;
  const target = getTargetDate();
  const personA = personAInput.value;
  const personB = personBInput.value;
  const destination = destinationInput.value;

  if (!target) {
    setSearching(false);
    summary.textContent = "Choose a valid date and target arrival time.";
    results.innerHTML = "";
    return;
  }

  saveState();
  updateSummary(personA, personB, destination, target);

  if (scrollToResults) {
    document.getElementById("results-title").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  if (!navigator.onLine) {
    setSearching(false);
    technicalFallback(personA, personB, destination, target, "offline");
    return;
  }

  if (!window.NVSTransit?.fetchRoutes) {
    setSearching(false);
    technicalFallback(personA, personB, destination, target, "fallback");
    showToast("Live routing module did not load; showing demo data.");
    return;
  }

  setSearching(true);
  setDataMode("loading");
  renderLoading();

  try {
    const [routesA, routesB] = await Promise.all([
      window.NVSTransit.fetchRoutes(personA, destination, target),
      window.NVSTransit.fetchRoutes(personB, destination, target),
    ]);

    if (searchId !== activeSearchId) return;

    if (!routesA.length || !routesB.length) {
      setDataMode("live");
      renderNoRoutes(personA, personB, destination);
      updateSummary(personA, personB, destination, target, ` <span class="summary-note">· live · checked ${formatTime(new Date())}</span>`);
      return;
    }

    setDataMode("live");
    renderConnections(routesA, routesB, target);
    updateSummary(personA, personB, destination, target, ` <span class="summary-note">· live · checked ${formatTime(new Date())}</span>`);
  } catch (error) {
    if (searchId !== activeSearchId) return;

    console.warn("Live routing failed; using demo fallback:", error);
    technicalFallback(personA, personB, destination, target, "fallback");
    showToast("Live timetable unavailable right now — showing clearly marked demo routes.");
  } finally {
    if (searchId === activeSearchId) setSearching(false);
  }
}

function setTargetRelative(minutesFromNow) {
  const target = roundUpToMinutes(addMinutes(new Date(), minutesFromNow), 5);
  dateInput.value = localDateString(target);
  timeInput.value = localTimeString(target);
  saveState();
  search();
}

function setTargetClock(value) {
  dateInput.value = localDateString();
  timeInput.value = value;
  saveState();
  search();
}

function resetPlanner() {
  personAInput.value = "Lankow-Siedlung";
  personBInput.value = "Hegelstraße";
  destinationInput.value = "Dreescher Markt";
  dateInput.value = localDateString();
  timeInput.value = "17:00";

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }

  search();
  showToast("Planner reset");
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  connectionPill.classList.toggle("offline", !online);
  connectionLabel.textContent = online ? "Online" : "Offline";

  if (!online) {
    setDataMode("offline");
    showToast("Offline: saved app shell works, but real journeys need internet.");
  }
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  const isiOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isiOS) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function renderInstallHelp() {
  const platform = detectPlatform();

  if (isStandalone()) {
    installInstructions.innerHTML = `<p>This app is already running from your home screen.</p>`;
    dialogInstallButton.hidden = true;
    return;
  }

  if (deferredInstallPrompt) {
    installInstructions.innerHTML = `
      <p>Your browser can install this site as an app. It will get its own icon and open in a standalone window.</p>
    `;
    dialogInstallButton.hidden = false;
    return;
  }

  dialogInstallButton.hidden = true;

  if (platform === "ios") {
    installInstructions.innerHTML = `
      <p>On iPad or iPhone, install it from Safari:</p>
      <div class="install-step"><span class="install-step-number">1</span><div>Open this page in <strong>Safari</strong>.</div></div>
      <div class="install-step"><span class="install-step-number">2</span><div>Tap the <strong>Share</strong> button.</div></div>
      <div class="install-step"><span class="install-step-number">3</span><div>Choose <strong>Add to Home Screen</strong>, then confirm.</div></div>
    `;
    return;
  }

  if (platform === "android") {
    installInstructions.innerHTML = `
      <p>On Samsung/Android, your browser may offer an install button automatically. If not:</p>
      <div class="install-step"><span class="install-step-number">1</span><div>Open the browser menu <strong>⋮</strong>.</div></div>
      <div class="install-step"><span class="install-step-number">2</span><div>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</div></div>
      <div class="install-step"><span class="install-step-number">3</span><div>Confirm the installation.</div></div>
    `;
    return;
  }

  installInstructions.innerHTML = `
    <p>Open your browser menu and look for <strong>Install app</strong> or <strong>Add to Home screen</strong>. Supported browsers may also show an install icon in the address bar.</p>
  `;
}

async function triggerInstall() {
  if (!deferredInstallPrompt) {
    renderInstallHelp();
    if (!installDialog.open) installDialog.showModal();
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  dialogInstallButton.hidden = true;
}

plannerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  search({ scrollToResults: window.innerWidth <= 620 });
});

mobileSearchButton.addEventListener("click", () => {
  search({ scrollToResults: true });
});

document.getElementById("swapButton").addEventListener("click", () => {
  const a = personAInput.value;
  personAInput.value = personBInput.value;
  personBInput.value = a;
  saveState();
  search();
  showToast("Starting points swapped");
});

document.getElementById("resetButton").addEventListener("click", resetPlanner);

document.querySelectorAll("[data-time-offset]").forEach((button) => {
  button.addEventListener("click", () => setTargetRelative(Number(button.dataset.timeOffset)));
});

document.querySelectorAll("[data-time-value]").forEach((button) => {
  button.addEventListener("click", () => setTargetClock(button.dataset.timeValue));
});

[personAInput, personBInput, destinationInput, dateInput, timeInput].forEach((input) => {
  input.addEventListener("change", saveState);
});

installButton.addEventListener("click", () => {
  renderInstallHelp();
  installDialog.showModal();
});

document.getElementById("closeInstallDialog").addEventListener("click", () => installDialog.close());
dialogInstallButton.addEventListener("click", triggerInstall);

installDialog.addEventListener("click", (event) => {
  if (event.target === installDialog) installDialog.close();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installDialog.open) installDialog.close();
  showToast("Meet Schwerin installed");
});

window.addEventListener("online", () => {
  updateConnectionStatus();
  showToast("Back online — live routing is available again.");
});
window.addEventListener("offline", updateConnectionStatus);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // PWA caching is a convenience; planner functionality should not depend on it.
    });
  });
}

loadState();
updateConnectionStatus();
search();