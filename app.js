const APP_VERSION = "0.1.1";
const STORAGE_KEY = "nvs-meetup-planner-state-v1";

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
const installButton = document.getElementById("installButton");
const installDialog = document.getElementById("installDialog");
const installInstructions = document.getElementById("installInstructions");
const dialogInstallButton = document.getElementById("dialogInstallButton");
const toast = document.getElementById("toast");

let deferredInstallPrompt = null;
let toastTimer = null;

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
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
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

function loadState() {
  dateInput.value = localDateString();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const state = JSON.parse(raw);

    if ([...personAInput.options].some((option) => option.value === state.personA)) {
      personAInput.value = state.personA;
    }
    if ([...personBInput.options].some((option) => option.value === state.personB)) {
      personBInput.value = state.personB;
    }
    if ([...destinationInput.options].some((option) => option.value === state.destination)) {
      destinationInput.value = state.destination;
    }
    if (typeof state.date === "string" && state.date) dateInput.value = state.date;
    if (typeof state.time === "string" && state.time) timeInput.value = state.time;
  } catch {
    // Ignore malformed or unavailable saved state.
  }
}

// Demo-only journey generator. v0.2 will replace this boundary with real
// public-transport API results while keeping the pairing/scoring code below.
function generateDemoRoutes(origin, destination, targetTime) {
  const baseDurations = {
    Lankow: 22,
    "Hegelstraße": 15,
    "Dreescher Markt": 12,
  };

  let duration = baseDurations[origin] ?? 18;
  if (destination === "Hauptbahnhof") duration += 5;
  if (destination === "Marienplatz") duration += 2;
  if (origin === destination) duration = 7;

  const arrivalOffsets = [-30, -20, -10, -3, 6, 16, 26];

  return arrivalOffsets.map((offset, index) => {
    const arrival = addMinutes(targetTime, offset);
    const departure = addMinutes(arrival, -duration);

    return {
      id: `${origin}-${destination}-${index}`,
      origin,
      destination,
      departure,
      arrival,
      duration,
      description:
        origin === destination
          ? "Short walk"
          : origin === "Lankow" || origin === "Hegelstraße"
            ? "Walk → Tram 2 → Walk"
            : "Walk → Bus/Tram → Walk",
    };
  });
}

function createPairs(routesA, routesB, target) {
  const pairs = [];

  for (const routeA of routesA) {
    for (const routeB of routesB) {
      const latestArrival = routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;
      const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
      const targetDifference = signedMinutesBetween(latestArrival, target);
      const score = Math.abs(targetDifference) + waitingDifference * 1.8;

      pairs.push({
        routeA,
        routeB,
        latestArrival,
        waitingDifference,
        targetDifference,
        score,
      });
    }
  }

  return pairs;
}

function scoreDirectionalPair(pair, target, direction) {
  const targetDistance =
    direction === "early"
      ? (target.getTime() - pair.latestArrival.getTime()) / 60_000
      : (pair.latestArrival.getTime() - target.getTime()) / 60_000;

  return targetDistance + pair.waitingDifference * 1.5;
}

function chooseConnections(pairs, target) {
  const best = [...pairs].sort((a, b) => a.score - b.score)[0];

  const early = pairs
    .filter(
      (pair) =>
        pair !== best &&
        pair.routeA.arrival <= target &&
        pair.routeB.arrival <= target,
    )
    .sort(
      (a, b) =>
        scoreDirectionalPair(a, target, "early") -
        scoreDirectionalPair(b, target, "early"),
    )[0];

  const later = pairs
    .filter(
      (pair) =>
        pair !== best &&
        pair.routeA.arrival >= target &&
        pair.routeB.arrival >= target,
    )
    .sort(
      (a, b) =>
        scoreDirectionalPair(a, target, "later") -
        scoreDirectionalPair(b, target, "later"),
    )[0];

  return { early, best, later };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPerson(name, route, personClass) {
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
      </div>
    </div>
  `;
}

function targetMessage(pair) {
  if (pair.targetDifference === 0) return "On time";
  if (pair.targetDifference < 0) return `${Math.abs(pair.targetDifference)} min early`;
  return `${pair.targetDifference} min late`;
}

function renderCard(title, pair, type) {
  if (!pair) return "";

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

function getTargetDate() {
  if (!dateInput.value || !timeInput.value) return null;
  const target = new Date(`${dateInput.value}T${timeInput.value}`);
  return Number.isNaN(target.getTime()) ? null : target;
}

function search({ scrollToResults = false } = {}) {
  const target = getTargetDate();
  const personA = personAInput.value;
  const personB = personBInput.value;
  const destination = destinationInput.value;

  if (!target) {
    summary.textContent = "Choose a valid date and target arrival time.";
    results.innerHTML = "";
    return;
  }

  saveState();

  const routesA = generateDemoRoutes(personA, destination, target);
  const routesB = generateDemoRoutes(personB, destination, target);
  const pairs = createPairs(routesA, routesB, target);
  const connections = chooseConnections(pairs, target);

  summary.innerHTML = `
    <strong>${escapeHtml(personA)}</strong> + <strong>${escapeHtml(personB)}</strong>
    → ${escapeHtml(destination)} · ${formatShortDate(target)} at
    <strong>${formatTime(target)}</strong>
  `;

  results.innerHTML =
    renderCard("A little early", connections.early, "early") +
    renderCard("Closest together", connections.best, "best") +
    renderCard("A little later", connections.later, "later");

  if (scrollToResults) {
    document.getElementById("results-title").scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
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
  personAInput.value = "Lankow";
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
  connectionLabel.textContent = online ? "Online" : "Offline demo";

  if (!online) {
    showToast("Offline: the demo still works. Real routes will need a connection.");
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

document.getElementById("mobileSearchButton").addEventListener("click", () => {
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
  input.addEventListener("change", () => {
    saveState();
    search();
  });
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

window.addEventListener("online", updateConnectionStatus);
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
