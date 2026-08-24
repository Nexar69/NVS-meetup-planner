(() => {
  const results = document.getElementById("results");
  let timer = null;

  function text(value) {
    return String(value || "").trim();
  }

  function withPlatform(name, platform) {
    const cleanName = text(name);
    const cleanPlatform = text(platform);
    if (!cleanPlatform) return cleanName;
    if (!cleanName) return `Stop ${cleanPlatform}`;
    const lower = cleanName.toLocaleLowerCase("de-DE");
    const p = cleanPlatform.toLocaleLowerCase("de-DE");
    if (
      lower.endsWith(` ${p}`) ||
      lower.endsWith(`(${p})`) ||
      lower.includes(`bstg. ${p}`) ||
      lower.includes(`steig ${p}`) ||
      lower.includes(`gleis ${p}`)
    ) return cleanName;
    return `${cleanName} ${cleanPlatform}`;
  }

  function modeName(segment) {
    const mode = text(segment?.mode).toUpperCase();
    const label = text(segment?.modeLabel);
    if (label && !/footpath/i.test(label)) return label;
    return {
      WALK: "Walk",
      TRAM: "Tram",
      BUS: "Bus",
      SUBURBAN: "S-Bahn",
      SUBWAY: "U-Bahn",
      RAIL: "Train",
      REGIONAL_RAIL: "Train",
      REGIONAL_FAST_RAIL: "Train",
      LONG_DISTANCE: "Train",
      HIGHSPEED_RAIL: "Train",
      FERRY: "Ferry",
      TAXI: "Taxi",
    }[mode] || (label || "Transit");
  }

  function vehicleName(segment) {
    const base = modeName(segment);
    const line = text(segment?.line);
    if (!line) return base;
    const normalized = base.toLocaleLowerCase("de-DE");
    if (normalized.includes(line.toLocaleLowerCase("de-DE"))) return base;
    return `${base} ${line}`;
  }

  function isWalk(segment) {
    return text(segment?.mode).toUpperCase() === "WALK" || /footpath|walk|fuß|fuss/i.test(`${segment?.title || ""} ${segment?.modeLabel || ""}`);
  }

  function isStayOn(segment) {
    const haystack = [
      segment?.title,
      ...(Array.isArray(segment?.instructions) ? segment.instructions : []),
    ].map(text).join(" ").toLocaleLowerCase("de-DE");
    return /nicht umsteigen|stay on|remain on|durchgehend|sitzen bleiben|im fahrzeug bleiben/.test(haystack);
  }

  function delayLabel(segment) {
    const delay = Number(segment?.departureDelay || segment?.arrivalDelay || 0);
    if (!Number.isFinite(delay) || delay === 0) return "";
    return delay > 0 ? `+${delay} min delay` : `${Math.abs(delay)} min early`;
  }

  function instructionFor(segment) {
    const from = withPlatform(segment?.from || "Start", segment?.platformFrom);
    const to = withPlatform(segment?.to || "Next stop", segment?.platformTo);
    const duration = Number(segment?.duration);
    const durationText = Number.isFinite(duration) && duration > 0 ? `${duration} min` : "";
    const delay = delayLabel(segment);

    if (isWalk(segment)) {
      return {
        title: `Walk to ${to || "the next stop"}`,
        detail: [from ? `From ${from}` : "", durationText].filter(Boolean).join(" · "),
        status: delay,
      };
    }

    const vehicle = vehicleName(segment);
    const direction = text(segment?.headsign);
    const stay = isStayOn(segment);
    const title = `${stay ? "Stay on " : ""}${vehicle}${to ? ` → ${to}` : ""}`;
    const boarding = from ? (stay ? `Continue from ${from}` : `Board at ${from}`) : "";
    return {
      title,
      detail: [boarding, direction ? `toward ${direction}` : "", durationText].filter(Boolean).join(" · "),
      status: delay,
    };
  }

  function decorateFullTimeline(timeline, assignment) {
    const segments = Array.isArray(assignment?.route?.segments) ? assignment.route.segments.filter(Boolean) : [];
    const steps = [...timeline.querySelectorAll(".timeline-step")];
    if (!segments.length || !steps.length) return;

    steps.forEach((step, index) => {
      const segment = segments[index];
      if (!segment) return;
      const instruction = instructionFor(segment);
      const copy = step.querySelector(".timeline-copy");
      if (!copy) return;

      const strong = copy.querySelector(":scope > strong");
      const routeLine = copy.querySelector(":scope > span");
      const smalls = [...copy.querySelectorAll(":scope > small")];
      const primaryMeta = smalls.find((node) => !node.classList.contains("timeline-via") && !node.classList.contains("timeline-instructions"));

      if (strong) strong.textContent = instruction.title;
      if (routeLine) routeLine.textContent = instruction.detail;
      if (primaryMeta) {
        primaryMeta.textContent = instruction.status;
        primaryMeta.hidden = !instruction.status;
      }
      step.dataset.actionInstructions = "true";
    });
  }

  function currentFocusAssignment() {
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    const assignments = Array.isArray(recommendations?.primary?.assignments) ? recommendations.primary.assignments : [];
    const focus = Number(window.NVSShare?.getFocusIndex?.() ?? -1);
    return Number.isInteger(focus) && focus >= 0 ? assignments[focus] : null;
  }

  function decoratePersonalPlan() {
    const assignment = currentFocusAssignment();
    const container = document.getElementById("personalSharedPlan");
    if (!assignment?.route || !container) return;
    const segments = Array.isArray(assignment.route.segments) ? assignment.route.segments.filter(Boolean) : [];
    const steps = [...container.querySelectorAll(".personal-route-step")];

    steps.forEach((step, index) => {
      const segment = segments[index];
      if (!segment) return;
      const instruction = instructionFor(segment);
      const strong = step.querySelector("strong");
      const small = step.querySelector("small");
      if (strong) {
        const join = strong.querySelector(".personal-inline-join")?.cloneNode(true) || null;
        strong.textContent = instruction.title;
        if (join) strong.appendChild(join);
      }
      if (small) small.textContent = [instruction.detail, instruction.status].filter(Boolean).join(" · ");
      step.dataset.actionInstructions = "true";
    });
  }

  function decorate() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
      if (recommendations && results) {
        [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
          const group = recommendations[card.dataset.mapPair];
          const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
          [...card.querySelectorAll(".route-timeline")].forEach((timeline, index) => {
            decorateFullTimeline(timeline, assignments[index]);
          });
        });
      }
      decoratePersonalPlan();
    }, 40);
  }

  window.addEventListener("nvs-group-recommendations-rendered", decorate);
  window.addEventListener("nvs-display-options-change", decorate);
  window.addEventListener("load", decorate);
  if (results) new MutationObserver(decorate).observe(results, { childList: true, subtree: true });
  new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });

  window.NVSInstructions = Object.freeze({ instructionFor });
  decorate();
})();
