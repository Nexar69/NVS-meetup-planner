(() => {
  const VERSION = "v0.8.1 · Stable iPad map + VMV short links";
  const results = document.getElementById("results");
  const badge = document.getElementById("dataBadgeLabel");
  const liveNote = document.querySelector(".live-note div");
  let currentProvider = window.NVSTransit?.getProviderStatus?.().provider || "Transitous";
  let fallback = false;
  let fallbackReason = "";
  let timer = null;

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

  function updateCopy() {
    const version = document.getElementById("versionLabel");
    if (version) version.textContent = VERSION;
    if (liveNote) {
      const backend = window.NVSConfig?.hasBackend;
      liveNote.innerHTML = backend
        ? `<strong>v0.8.1 prefers VMV.</strong> Routes use VMV / MV FÄHRT GUT when available, fall back to Transitous automatically, shared plans use short 72-hour links, and the iPad map now repairs its tile grid after PWA/viewport restores.`
        : `<strong>v0.8.1 is backend-ready.</strong> Transitous remains active until the Cloudflare Worker URL is configured; short-link sharing automatically falls back to encoded links.`;
    }
    if (badge && !badge.textContent?.includes("Checking") && !badge.textContent?.includes("Loading")) {
      badge.textContent = fallback ? `${providerLabel(currentProvider)} fallback` : providerLabel(currentProvider);
      badge.title = fallback && fallbackReason
        ? `VMV unavailable for this request (${fallbackReason}); Transitous was used automatically.`
        : `Routing provider: ${providerLabel(currentProvider)}`;
    }
  }

  function decorateProviders() {
    clearTimeout(timer);
    timer = setTimeout(() => {
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
    }, 30);
  }

  window.addEventListener("nvs-routing-provider", (event) => {
    currentProvider = event.detail?.provider || currentProvider;
    fallback = Boolean(event.detail?.fallback);
    fallbackReason = String(event.detail?.reason || "");
    updateCopy();
  });
  window.addEventListener("nvs-group-recommendations-rendered", decorateProviders);
  window.addEventListener("load", () => { updateCopy(); decorateProviders(); });
  if (results) new MutationObserver(decorateProviders).observe(results, { childList: true, subtree: true });

  const style = document.createElement("style");
  style.textContent = `
    .v080-provider-chip{display:inline-flex;align-items:center;gap:4px;width:max-content;margin-top:3px;padding:2px 6px;border:1px solid #e4e7ec;border-radius:999px;background:#f9fafb;color:#667085;font-size:9px;font-weight:800;line-height:1.2}
    .v080-provider-chip span{font-size:6px;color:#12b76a}
  `;
  document.head.appendChild(style);

  updateCopy();
})();
