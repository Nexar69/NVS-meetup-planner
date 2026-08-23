const dateInput = document.getElementById("date");
const timeInput = document.getElementById("time");
const personAInput = document.getElementById("personA");
const personBInput = document.getElementById("personB");
const destinationInput = document.getElementById("destination");
const results = document.getElementById("results");
const summary = document.getElementById("summary");

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

dateInput.value = localDateString();

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

// Demo-only journey generator. In v0.2 this is the function we replace with
// real public-transport API results.
function generateDemoRoutes(origin, targetTime) {
  const demoDurations = {
    Lankow: 22,
    "Hegelstraße": 15,
    "Dreescher Markt": 12,
  };

  const duration = demoDurations[origin] ?? 18;
  const arrivalOffsets = [-28, -18, -8, -2, 7, 17, 27];

  return arrivalOffsets.map((offset, index) => {
    const arrival = addMinutes(targetTime, offset);
    const departure = addMinutes(arrival, -duration);

    return {
      id: `${origin}-${index}`,
      origin,
      departure,
      arrival,
      duration,
      description:
        origin === "Lankow" || origin === "Hegelstraße"
          ? "Walk → Tram 2 → Walk"
          : "Walk → Bus/Tram → Walk",
    };
  });
}

function createPairs(routesA, routesB, target) {
  const pairs = [];

  for (const routeA of routesA) {
    for (const routeB of routesB) {
      const latestArrival =
        routeA.arrival > routeB.arrival ? routeA.arrival : routeB.arrival;

      const waitingDifference = minutesBetween(routeA.arrival, routeB.arrival);
      const targetDifference = signedMinutesBetween(latestArrival, target);

      // The heart of the app: being close to the requested meetup time matters,
      // but making one person wait a long time is deliberately penalized more.
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
  const byBestScore = [...pairs].sort((a, b) => a.score - b.score);
  const best = byBestScore[0];

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

function renderPerson(name, route) {
  return `
    <div class="person">
      <div>
        <div class="person-name">${escapeHtml(name)}</div>
        <div class="journey-description">
          ${escapeHtml(route.description)} · ${route.duration} min
        </div>
      </div>
      <div class="time-info">
        <div class="main-time">
          ${formatTime(route.departure)} → ${formatTime(route.arrival)}
        </div>
        <div class="arrival">Arrive ${formatTime(route.arrival)}</div>
      </div>
    </div>
  `;
}

function targetMessage(pair) {
  if (pair.targetDifference === 0) return "Exactly on target";
  if (pair.targetDifference < 0) {
    return `${Math.abs(pair.targetDifference)} min early`;
  }
  return `${pair.targetDifference} min late`;
}

function renderCard(title, pair, type) {
  if (!pair) return "";

  const labels = {
    early: "Early",
    best: "⭐ Best match",
    later: "Later",
  };

  return `
    <article class="result ${type === "best" ? "best" : ""}">
      <div class="result-header">
        <div>
          <div class="result-title">${escapeHtml(title)}</div>
          <div class="result-subtitle">
            Meet around ${formatTime(pair.latestArrival)}
          </div>
        </div>
        <span class="badge ${type === "best" ? "best" : ""}">
          ${labels[type]}
        </span>
      </div>

      ${renderPerson("You", pair.routeA)}
      ${renderPerson("Friend", pair.routeB)}

      <div class="meeting-info">
        <span>
          Waiting difference: <strong>${pair.waitingDifference} min</strong>
        </span>
        <span>
          Target: <strong>${targetMessage(pair)}</strong>
        </span>
      </div>
    </article>
  `;
}

function search() {
  const date = dateInput.value;
  const time = timeInput.value;
  const personA = personAInput.value;
  const personB = personBInput.value;
  const destination = destinationInput.value;

  if (!date || !time) return;

  const target = new Date(`${date}T${time}`);

  if (Number.isNaN(target.getTime())) {
    summary.textContent = "Please choose a valid date and time.";
    results.innerHTML = "";
    return;
  }

  const routesA = generateDemoRoutes(personA, target);
  const routesB = generateDemoRoutes(personB, target);
  const pairs = createPairs(routesA, routesB, target);
  const connections = chooseConnections(pairs, target);

  summary.innerHTML = `
    <strong>${escapeHtml(personA)}</strong> +
    <strong>${escapeHtml(personB)}</strong> →
    ${escapeHtml(destination)} · meet at
    <strong>${formatTime(target)}</strong>
  `;

  results.innerHTML =
    renderCard("A little early", connections.early, "early") +
    renderCard("Closest together", connections.best, "best") +
    renderCard("A little later", connections.later, "later");
}

document.getElementById("searchButton").addEventListener("click", search);

search();
