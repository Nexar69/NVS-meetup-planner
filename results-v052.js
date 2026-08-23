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
        ? { title: "Fastest practical match", badge: "⚡ Fastest", note: "Prioritises shorter total travel time while staying near your target." }
        : { title: "Fast backup", badge: "Backup", note: "Next-best fast option near your target." };
    }

    return primary
      ? { title: "Best together", badge: "🤝 Least waiting", note: "Prioritises a small arrival gap so neither person waits long." }
      : { title: "Together backup", badge: "Backup", note: "Next-best low-wait option near your target." };
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

  function targetMessageSafe(pair) {
    const diff = Number(pair.targetDifference) || 0;
    if (diff === 0) return "On time";
    if (diff < 0) return `${Math.abs(diff)} min early`;
    return `${diff} min late`;
  }

  function recommendationCard(pair, slot, mode) {
    if (!pair) return "";
    const primary = slot === "primary";
    const copy = modeCopy(mode, primary);

    return `
      <article class="result ${primary ? "best v052-primary" : "v052-backup"}" data-map-pair="${slot}">
        <div class="result-header">
          <div>
            <div class="result-title">${escapeHtmlSafe(copy.title)}</div>
            <div class="result-subtitle">Together around ${formatTimeSafe(pair.latestArrival)}</div>
          </div>
          <span class="v052-mode-badge">${escapeHtmlSafe(copy.badge)}</span>
        </div>

        ${personHtml("You", pair.routeA, "person-dot-you")}
        ${personHtml("Friend", pair.routeB, "person-dot-friend")}

        <div class="meeting-info">
          <div class="metric"><span>Arrival gap</span><strong>${pair.waitingDifference} min</strong></div>
          <div class="metric"><span>Target</span><strong>${escapeHtmlSafe(targetMessageSafe(pair))}</strong></div>
        </div>
        <div class="meeting-info">
          <div class="metric"><span>Total travel</span><strong>${pair.totalTravel} min</strong></div>
          <div class="metric"><span>Longest trip</span><strong>${pair.maxTravel} min</strong></div>
        </div>
        <p class="v052-recommendation-note">${escapeHtmlSafe(copy.note)}</p>
      </article>
    `;
  }

  function renderRecommendedConnections(routesA, routesB, target) {
    const engine = window.NVSRecommend;
    if (!engine?.recommend) return false;

    const recommendations = engine.recommend(routesA, routesB, target);
    if (!recommendations.primary) return false;

    const results = document.getElementById("results");
    if (!results) return false;

    results.classList.add("v052-recommendations");
    results.innerHTML =
      recommendationCard(recommendations.primary, "primary", recommendations.mode) +
      recommendationCard(recommendations.backup, "backup", recommendations.mode);

    window.__NVS_LAST_RECOMMENDATIONS__ = recommendations;
    window.dispatchEvent(new CustomEvent("nvs-recommendations-rendered", { detail: recommendations }));
    return true;
  }

  // app.js defines renderConnections globally. Replacing it here keeps all of
  // the existing loading/offline/PWA behavior while changing only ranking/UI.
  window.renderConnections = renderRecommendedConnections;

  // Re-run once so an initial search that started before this script loaded
  // also uses the v0.5.2 renderer. Transit requests are already cached.
  setTimeout(() => document.getElementById("plannerForm")?.requestSubmit(), 0);
})();
