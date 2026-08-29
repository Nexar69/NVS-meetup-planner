(() => {
  const VERSION = "v0.8.3 · Action-first journey directions";
  const DISPLAY_KEY = "meet-schwerin-display-v1";
  const results = document.getElementById("results");
  const badge = document.getElementById("dataBadgeLabel");
  const liveNote = document.querySelector(".live-note div");
  let currentProvider = window.NVSTransit?.getProviderStatus?.().provider || "Transitous";
  let fallback = false;
  let fallbackReason = "";
  let timer = null;
  let showIntermediateStops = false;
  let recommendationsActive = Boolean(window.__NVS_LAST_RECOMMENDATIONS__);

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function providerLabel(value) {
    return String(value || "").includes("VMV") ? "VMV / MV FÄHRT GUT" : "Transitous";
  }

  function readDisplayState() {
    try {
      const saved = JSON.parse(localStorage.getItem(DISPLAY_KEY) || "{}");
      showIntermediateStops = saved.showIntermediateStops === true;
    } catch {
      showIntermediateStops = false;
    }
  }

  function writeDisplayState() {
    try {
      localStorage.setItem(DISPLAY_KEY, JSON.stringify({ showIntermediateStops }));
    } catch {
      // Local storage is optional.
    }
  }

  function applyDisplayState() {
    document.documentElement.classList.toggle("nvs-hide-via", !showIntermediateStops);
    const toggle = document.getElementById("showIntermediateStopsToggle");
    if (toggle) {
      toggle.setAttribute("aria-checked", String(showIntermediateStops));
      toggle.classList.toggle("active", showIntermediateStops);
      const state = toggle.querySelector(".v082-toggle-state");
      if (state) state.textContent = showIntermediateStops ? "On" : "Off";
    }
  }

  function setIntermediateStops(next) {
    showIntermediateStops = Boolean(next);
    writeDisplayState();
    applyDisplayState();
    window.dispatchEvent(new CustomEvent("nvs-display-options-change", {
      detail: { showIntermediateStops },
    }));
  }

  function installDisplayOptions() {
    const control = document.getElementById("optimizationControl");
    if (!control || document.getElementById("displayOptionsBlock")) return Boolean(control);

    const divider = document.createElement("div");
    divider.className = "v060-control-divider";
    divider.dataset.v082Display = "true";

    const block = document.createElement("div");
    block.id = "displayOptionsBlock";
    block.className = "v060-control-block v082-display-block";
    block.innerHTML = `
      <div class="optimization-heading">
        <div><span class="optimization-kicker">Display</span><strong>Journey details</strong></div>
      </div>
      <button type="button" id="showIntermediateStopsToggle" class="v082-display-toggle" role="switch" aria-checked="false">
        <span>
          <strong>Show intermediate stops</strong>
          <small>List every stop under each tram, bus or train leg</small>
        </span>
        <span class="v082-toggle-state">Off</span>
      </button>
    `;

    control.append(divider, block);
    block.querySelector("#showIntermediateStopsToggle")?.addEventListener("click", () => {
      setIntermediateStops(!showIntermediateStops);
    });
    applyDisplayState();
    return true;
  }

  function updateCopy() {
    const v090OwnsReleaseCopy = window.NVSRelease090 || document.documentElement.dataset.nvsRelease === "090";
    if (!v090OwnsReleaseCopy) {
      const version = document.getElementById("versionLabel");
      if (version) version.textContent = VERSION;
      if (liveNote) {
        const backend = window.NVSConfig?.hasBackend;
        liveNote.innerHTML = backend
          ? `<strong>v0.8.3 makes routes easier to follow.</strong> VMV remains preferred with Transitous fallback, short shared links stay active, intermediate stops remain optional, and journey legs now lead with clear actions like Board, Stay on, Walk to and stay on until.`
          : `<strong>v0.8.3 is backend-ready.</strong> Transitous remains active until the Cloudflare Worker URL is configured; action-first directions and optional intermediate stops still work locally.`;
      }
    }

    if (badge && !badge.textContent?.includes("Checking") && !badge.textContent?.includes("Loading")) {
      badge.textContent = fallback ? `${providerLabel(currentProvider)} fallback` : providerLabel(currentProvider);
      badge.title = fallback && fallbackReason
        ? `VMV unavailable for this request (${fallbackReason}); Transitous was used automatically.`
        : `Routing provider: ${providerLabel(currentProvider)}`;
    }
  }

  function cancelProviderDecoration() {
    clearTimeout(timer);
    timer = null;
  }

  function removeProviderDecoration() {
    if (!results) return;
    results.querySelectorAll(".v080-provider-chip").forEach((chip) => chip.remove());
  }

  function decorateProviders() {
    cancelProviderDecoration();
    if (!recommendationsActive) return;
    timer = setTimeout(() => {
      timer = null;
      if (!recommendationsActive) return;
      const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
      if (!recommendations || !results) return;
      [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
        const group = recommendations[card.dataset.mapPair];
        const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
        [...card.querySelectorAll(".group-card-person")].forEach((row, index) => {
          const provider = assignments[index]?.route?.provider || (assignments[index]?.route?.source === "vmv" ? "VMV / MV FÄHRT GUT" : "Transitous");
          let chip = row.querySelector(".v080-provider-chip");
          if (!chip) {
            chip = document.createElement("span");
            chip.className = "v080-provider-chip";
            const copy = row.querySelector(".group-person-copy");
            copy?.appendChild(chip);
          }
          if (chip) chip.innerHTML = `<span aria-hidden="true">●</span> ${escapeHtml(providerLabel(provider))}`;
        });
      });
      updateCopy();
      applyDisplayState();
    }, 30);
  }

  function activateRecommendations() {
    recommendationsActive = true;
    decorateProviders();
  }

  function clearRecommendations() {
    recommendationsActive = false;
    cancelProviderDecoration();
    removeProviderDecoration();
  }

  readDisplayState();
  applyDisplayState();

  window.addEventListener("nvs-routing-provider", (event) => {
    currentProvider = event.detail?.provider || currentProvider;
    fallback = Boolean(event.detail?.fallback);
    fallbackReason = String(event.detail?.reason || "");
    updateCopy();
  });
  window.addEventListener("nvs-group-recommendations-rendered", activateRecommendations);
  window.addEventListener("nvs-recommendations-cleared", clearRecommendations);
  window.addEventListener("load", () => {
    updateCopy();
    decorateProviders();
    installDisplayOptions();
  });
  if (results) new MutationObserver(decorateProviders).observe(results, { childList: true, subtree: true });

  if (!installDisplayOptions()) {
    const observer = new MutationObserver(() => {
      if (installDisplayOptions()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const style = document.createElement("style");
  style.textContent = `
    .v080-provider-chip{display:inline-flex;align-items:center;gap:4px;width:max-content;margin-top:3px;padding:2px 6px;border:1px solid #e4e7ec;border-radius:999px;background:#f9fafb;color:#667085;font-size:9px;font-weight:800;line-height:1.2}
    .v080-provider-chip span{font-size:6px;color:#12b76a}
    .nvs-hide-via .timeline-via{display:none!important}
    .v082-display-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;min-height:58px;padding:10px 12px;border:1px solid #e4e7ec;border-radius:14px;background:#f9fafb;color:#344054;text-align:left;cursor:pointer}
    .v082-display-toggle>span:first-child{display:grid;gap:2px}
    .v082-display-toggle strong{font-size:12px}
    .v082-display-toggle small{color:#667085;font-size:10px;line-height:1.35}
    .v082-toggle-state{flex:0 0 auto;min-width:38px;padding:5px 8px;border-radius:999px;background:#eaecf0;color:#667085;font-size:10px;font-weight:850;text-align:center}
    .v082-display-toggle.active{border-color:#abefc6;background:#ecfdf3}
    .v082-display-toggle.active .v082-toggle-state{background:#12b76a;color:#fff}
  `;
  document.head.appendChild(style);

  window.NVSDisplayOptions = Object.freeze({
    getShowIntermediateStops: () => showIntermediateStops,
    setShowIntermediateStops: setIntermediateStops,
  });

  updateCopy();
})();