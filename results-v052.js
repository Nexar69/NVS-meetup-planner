(() => {
  function escapeHtmlSafe(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatTimeSafe(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function modeCopy(mode, primary) {
    if (mode === "fastest") {
      return primary
        ? { title: "Fastest practical match", badge: "⚡ Fastest", note: "Shorter travel time wins when timings are otherwise practical." }
        : { title: "Fast backup", badge: "Backup", note: "The next-best fast option." };
    }

    if (mode === "easy") {
      return primary
        ? { title: "Easiest practical match", badge: "😌 Easy trip", note: "Fewer changes and less walking, without ignoring journey time." }
        : { title: "Easy backup", badge: "Backup", note: "Another simple route pair if plans change." };
    }

    return primary
      ? { title: "Best together", badge: "🤝 Least waiting", note: "A small arrival gap is prioritised so neither person waits long." }
      : { title: "Together backup", badge: "Backup", note: "The next-best low-wait option." };
  }

  function routeMetaSafe(route) {
    const parts = [];
    if (Number.isFinite(route?.transfers)) {
      parts.push(route.transfers === 0 ? "Direct" : `${route.transfers} change${route.transfers === 1 ? "" : "s"}`);
    }
    if (route?.realtime) parts.push("Realtime");
    return parts.join(" · ");
  }

  function personHtml(label, route, dotClass) {
    const meta = routeMetaSafe(route);
    return `
      <div class="person">
        <div>
          <div class="person-topline">
            <div class="person-name"><span class="person-dot ${dotClass}" aria-hidden="true"></span>${escapeHtmlSafe(label)}</div>
            <span class="duration-chip">${Number(route.duration) || "—"} min</span>
          </div>
          <div class="main-time">${formatTimeSafe(route.departure)} → ${formatTimeSafe(route.arrival)}</div>
          <div class="journey-description">${escapeHtmlSafe(route.description || "Public transport")}</div>
          ${meta ? `<div class="route-meta">${escapeHtmlSafe(meta)}</div>` : ""}
        </div>
      </div>
    `;
  }

  function targetMessageSafe(pair, timingMode) {
    if (timingMode === "asap") return `~${pair.asapMinutes} min from now`;
    const diff = Number(pair.targetDifference) || 0;
    if (diff === 0) return "On time";
    if (diff < 0) return `${Math.abs(diff)} min early`;
    return `${diff} min late`;
  }

  function recommendationCard(pair, slot, mode, timingMode) {
    if (!pair) return "";
    const primary = slot === "primary";
    const copy = modeCopy(mode, primary);
    const explanation = window.NVSRecommend?.explain?.(pair, mode, timingMode) || copy.note;
    const subtitle = timingMode === "asap"
      ? `Both there by ${formatTimeSafe(pair.latestArrival)}`
      : `Together around ${formatTimeSafe(pair.latestArrival)}`;

    return `
      <article class="result ${primary ? "best v052-primary" : "v052-backup"}" data-map-pair="${slot}">
        <div class="result-header">
          <div>
            <div class="result-title">${escapeHtmlSafe(copy.title)}</div>
            <div class="result-subtitle">${escapeHtmlSafe(subtitle)}</div>
          </div>
          <span class="v052-mode-badge">${escapeHtmlSafe(copy.badge)}</span>
        </div>

        ${personHtml("You", pair.routeA, "person-dot-you")}
        ${personHtml("Friend", pair.routeB, "person-dot-friend")}

        <div class="meeting-info">
          <div class="metric"><span>Arrival gap</span><strong>${pair.waitingDifference} min</strong></div>
          <div class="metric"><span>${timingMode === "asap" ? "Meet" : "Target"}</span><strong>${escapeHtmlSafe(targetMessageSafe(pair, timingMode))}</strong></div>
        </div>
        <div class="meeting-info">
          <div class="metric"><span>Total travel</span><strong>${pair.totalTravel} min</strong></div>
          <div class="metric"><span>Changes + walk</span><strong>${pair.totalTransfers} · ${pair.totalWalk} min</strong></div>
        </div>

        <div class="v060-why">
          <span>Why this one?</span>
          <strong>${escapeHtmlSafe(explanation)}</strong>
        </div>
        <p class="v052-recommendation-note">${escapeHtmlSafe(copy.note)}</p>
      </article>
    `;
  }

  function rewriteSummaryForAsap(recommendations) {
    if (recommendations?.timingMode !== "asap" || !recommendations.primary) return;
    setTimeout(() => {
      const summary = document.getElementById("summary");
      const personA = document.getElementById("personA")?.selectedOptions?.[0]?.textContent || "You";
      const personB = document.getElementById("personB")?.selectedOptions?.[0]?.textContent || "Friend";
      const destination = document.getElementById("destination")?.selectedOptions?.[0]?.textContent || "meetup";
      if (!summary) return;
      summary.innerHTML = `<strong>${escapeHtmlSafe(personA)}</strong> + <strong>${escapeHtmlSafe(personB)}</strong> → ${escapeHtmlSafe(destination)} · <strong>ASAP</strong> · both there by <strong>${formatTimeSafe(recommendations.primary.latestArrival)}</strong>`;
    }, 0);
  }

  function renderNoFreshAsapRoutes(results) {
    if (!results) return false;
    results.classList.remove("v052-recommendations");
    results.innerHTML = `
      <div class="loading-card no-routes-card" role="status">
        <span aria-hidden="true">↻</span>
        <div>
          <strong>No fresh ASAP connection found</strong>
          <p>The returned journeys have already arrived. Check again for a newer connection instead of using stale timetable results.</p>
        </div>
      </div>
    `;
    window.__NVS_LAST_RECOMMENDATIONS__ = null;
    setTimeout(() => {
      const summary = document.getElementById("summary");
      const personA = document.getElementById("personA")?.selectedOptions?.[0]?.textContent || "You";
      const personB = document.getElementById("personB")?.selectedOptions?.[0]?.textContent || "Friend";
      const destination = document.getElementById("destination")?.selectedOptions?.[0]?.textContent || "meetup";
      if (!summary) return;
      summary.innerHTML = `<strong>${escapeHtmlSafe(personA)}</strong> + <strong>${escapeHtmlSafe(personB)}</strong> → ${escapeHtmlSafe(destination)} · <strong>ASAP</strong> · no fresh connection yet`;
    }, 0);
    return true;
  }

  function renderRecommendedConnections(routesA, routesB, target) {
    const engine = window.NVSRecommend;
    if (!engine?.recommend) return false;

    const recommendations = engine.recommend(routesA, routesB, target);
    const results = document.getElementById("results");
    if (!results) return false;

    if (!recommendations.primary) {
      if (recommendations.timingMode === "asap") return renderNoFreshAsapRoutes(results);
      window.__NVS_LAST_RECOMMENDATIONS__ = null;
      return false;
    }

    results.classList.add("v052-recommendations");
    results.innerHTML =
      recommendationCard(recommendations.primary, "primary", recommendations.mode, recommendations.timingMode) +
      recommendationCard(recommendations.backup, "backup", recommendations.mode, recommendations.timingMode);

    window.__NVS_LAST_RECOMMENDATIONS__ = recommendations;
    window.dispatchEvent(new CustomEvent("nvs-recommendations-rendered", { detail: recommendations }));
    rewriteSummaryForAsap(recommendations);
    return true;
  }

  function updateReleaseCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = "v0.6.0 · Meetup timing + smart route priorities";
    const title = document.getElementById("results-title");
    if (title) title.textContent = "Best meetup matches";
    const liveNote = document.querySelector(".live-note div");
    if (liveNote) liveNote.innerHTML = `<strong>v0.6 separates when you want to meet from how you want to travel.</strong> Choose a target time or Meet ASAP, then optimise for arriving together, getting there fastest, or taking an easier trip. Recommendations now explain why they were selected.`;
  }

  window.renderConnections = renderRecommendedConnections;
  updateReleaseCopy();
  setTimeout(() => document.getElementById("plannerForm")?.requestSubmit(), 0);
})();