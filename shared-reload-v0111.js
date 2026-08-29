(() => {
  const FALLBACK_MS = 1_200;
  let navigating = false;
  let fallbackTimer = null;

  function reloadButtonFrom(target) {
    return target?.closest?.("#v010ReloadPlan") || null;
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = Boolean(loading);
    button.setAttribute?.("aria-busy", String(Boolean(loading)));
    if (loading) {
      if (!button.dataset.nvsReloadLabel) button.dataset.nvsReloadLabel = button.textContent || "Reload updated plan";
      button.textContent = "Loading updated plan…";
    } else {
      button.textContent = button.dataset.nvsReloadLabel || "Reload updated plan";
      button.removeAttribute?.("aria-busy");
    }
  }

  function clearFallback() {
    if (fallbackTimer != null) clearTimeout(fallbackTimer);
    fallbackTimer = null;
  }

  function recoverNavigation(button = document.getElementById("v010ReloadPlan")) {
    clearFallback();
    navigating = false;
    setLoading(button, false);
  }

  function tryAssign(button) {
    try {
      window.location.assign(window.location.href);
      return true;
    } catch {
      recoverNavigation(button);
      return false;
    }
  }

  function reloadUpdatedPlan(button = document.getElementById("v010ReloadPlan")) {
    if (navigating) return false;
    navigating = true;
    setLoading(button, true);

    try {
      window.dispatchEvent(new CustomEvent("nvs-shared-plan-reload-requested"));
    } catch {}

    clearFallback();
    fallbackTimer = setTimeout(() => {
      if (!navigating) return;
      tryAssign(button);
    }, FALLBACK_MS);

    try {
      window.location.reload();
    } catch {
      tryAssign(button);
    }
    return navigating;
  }

  function resetAfterPageShow(event) {
    recoverNavigation();

    if (!event?.persisted) return;
    setTimeout(() => {
      try { window.NVSSharedLive?.refresh?.(); } catch {}
      try { window.NVSIntelligence?.refresh?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent("nvs-shared-view-resumed")); } catch {}
    }, 0);
  }

  document.addEventListener("click", (event) => {
    const button = reloadButtonFrom(event.target);
    if (!button) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    reloadUpdatedPlan(button);
  }, true);

  window.addEventListener("pageshow", resetAfterPageShow);
  window.addEventListener("pagehide", clearFallback);

  window.NVSSharedReload0111 = Object.freeze({
    reloadUpdatedPlan,
    resetAfterPageShow,
    isNavigating: () => navigating,
  });
})();
