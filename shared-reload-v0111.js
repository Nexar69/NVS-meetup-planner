(() => {
  const FALLBACK_MS = 1_200;
  let navigating = false;
  let fallbackTimer = null;
  let resumeTimer = null;
  let lifecycleFrozen = false;

  function ownsVisibleLifecycle() {
    return !lifecycleFrozen && !document.hidden;
  }

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

  function clearResume() {
    if (resumeTimer != null) clearTimeout(resumeTimer);
    resumeTimer = null;
  }

  function recoverNavigation(button = document.getElementById("v010ReloadPlan")) {
    clearFallback();
    navigating = false;
    setLoading(button, false);
  }

  function suspendVisibleWork() {
    clearFallback();
    clearResume();
    navigating = false;
  }

  function tryAssign(button) {
    if (!ownsVisibleLifecycle()) return false;
    try {
      window.location.assign(window.location.href);
      return true;
    } catch {
      recoverNavigation(button);
      return false;
    }
  }

  function reloadUpdatedPlan(button = document.getElementById("v010ReloadPlan")) {
    if (!ownsVisibleLifecycle() || navigating) return false;
    navigating = true;
    setLoading(button, true);

    try {
      window.dispatchEvent(new CustomEvent("nvs-shared-plan-reload-requested"));
    } catch {}

    clearFallback();
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (!ownsVisibleLifecycle() || !navigating) return;
      tryAssign(button);
    }, FALLBACK_MS);

    try {
      window.location.reload();
    } catch {
      tryAssign(button);
    }
    return navigating;
  }

  function queueResumeReconciliation() {
    clearResume();
    if (!ownsVisibleLifecycle()) return;
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!ownsVisibleLifecycle()) return;
      try { window.NVSSharedLive?.refresh?.(); } catch {}
      try { window.NVSIntelligence?.refresh?.(); } catch {}
      try { window.dispatchEvent(new CustomEvent("nvs-shared-view-resumed")); } catch {}
    }, 0);
  }

  function resetAfterPageShow(event) {
    lifecycleFrozen = false;
    if (!ownsVisibleLifecycle()) {
      suspendVisibleWork();
      return;
    }
    recoverNavigation();
    if (event?.persisted) queueResumeReconciliation();
  }

  function freezeForPageHide() {
    lifecycleFrozen = true;
    suspendVisibleWork();
  }

  function handleVisibilityChange() {
    if (document.hidden || lifecycleFrozen) {
      suspendVisibleWork();
      return;
    }
    recoverNavigation();
  }

  document.addEventListener("click", (event) => {
    const button = reloadButtonFrom(event.target);
    if (!button) return;
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    if (!ownsVisibleLifecycle()) return;
    reloadUpdatedPlan(button);
  }, true);

  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pageshow", resetAfterPageShow);
  window.addEventListener("pagehide", freezeForPageHide);

  window.NVSSharedReload0111 = Object.freeze({
    reloadUpdatedPlan,
    resetAfterPageShow,
    isNavigating: () => navigating,
    isLifecycleFrozen: () => lifecycleFrozen,
  });
})();