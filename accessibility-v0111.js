(() => {
  const OPENERS = new Map();
  const DIALOGS = {
    v011TripDialog: {
      opener: "v011TripModeButton",
      close: ".v011-trip-close",
      label: "v011TripPerson",
      description: "v011TripDetail",
    },
    v011SettingsDialog: {
      opener: "v011AlertSettingsButton",
      close: ".v011-settings-close",
      label: "v011SettingsTitle",
      description: "v011SettingsDescription",
    },
  };

  let lifecycleFrozen = false;
  let focusGeneration = 0;
  let focusFrame = 0;

  function ownsDocument(generation = focusGeneration) {
    return !lifecycleFrozen && generation === focusGeneration;
  }

  function isUsableOpener(element) {
    if (!element?.isConnected || element.hidden || element.disabled) return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    if (element.closest?.("[inert]")) return false;
    return true;
  }

  function focusSafely(element, generation = focusGeneration) {
    if (!ownsDocument(generation) || !isUsableOpener(element) || !element?.focus) return;
    try { element.focus({ preventScroll: true }); } catch { try { element.focus(); } catch {} }
  }

  function activeOpenerFor(dialog) {
    const stored = OPENERS.get(dialog.id);
    if (isUsableOpener(stored)) return stored;
    const id = DIALOGS[dialog.id]?.opener;
    const fallback = id ? document.getElementById(id) : null;
    return isUsableOpener(fallback) ? fallback : null;
  }

  function enhanceDialog(dialog) {
    if (lifecycleFrozen) return;
    const config = DIALOGS[dialog?.id];
    if (!dialog || !config || dialog.dataset.v0111A11y === "true") return;
    dialog.dataset.v0111A11y = "true";
    dialog.setAttribute("aria-modal", "true");
    if (!dialog.getAttribute("role")) dialog.setAttribute("role", "dialog");
    if (config.label && document.getElementById(config.label)) dialog.setAttribute("aria-labelledby", config.label);
    if (config.description && document.getElementById(config.description)) dialog.setAttribute("aria-describedby", config.description);

    dialog.addEventListener("close", () => {
      const opener = activeOpenerFor(dialog);
      OPENERS.delete(dialog.id);
      const generation = focusGeneration;
      queueMicrotask(() => focusSafely(opener, generation));
    });

    dialog.addEventListener("cancel", () => {
      if (lifecycleFrozen) return;
      // Native <dialog> handles Escape; the close listener restores focus.
      OPENERS.set(dialog.id, activeOpenerFor(dialog));
    });
  }

  function enhanceSharedStatusList() {
    if (lifecycleFrozen) return;
    const list = document.getElementById("v010StatusList");
    if (!list) return;
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Meetup member status");
    list.querySelectorAll(".v010-person").forEach((row) => {
      row.setAttribute("role", "listitem");
    });
  }

  function enhanceLiveRegions() {
    if (lifecycleFrozen) return;
    const primary = document.getElementById("v011PrimaryAlert");
    if (primary) {
      primary.setAttribute("role", "status");
      primary.setAttribute("aria-live", "polite");
      primary.setAttribute("aria-atomic", "true");
    }
    const tripAlert = document.getElementById("v011TripAlert");
    if (tripAlert) {
      tripAlert.setAttribute("role", "status");
      tripAlert.setAttribute("aria-live", "polite");
      tripAlert.setAttribute("aria-atomic", "true");
    }
    const sharedSync = document.getElementById("v010Sync");
    if (sharedSync) {
      sharedSync.setAttribute("role", "status");
      sharedSync.setAttribute("aria-live", "polite");
      sharedSync.setAttribute("aria-atomic", "true");
    }
    const sharedAlert = document.getElementById("v010Alert");
    if (sharedAlert) {
      sharedAlert.setAttribute("role", "status");
      sharedAlert.setAttribute("aria-live", "polite");
      sharedAlert.setAttribute("aria-atomic", "true");
    }
    const planUpdate = document.getElementById("v010PlanUpdate");
    if (planUpdate) {
      planUpdate.setAttribute("role", "status");
      planUpdate.setAttribute("aria-live", "polite");
    }
    enhanceSharedStatusList();
  }

  function enhance() {
    if (lifecycleFrozen || document.hidden) return;
    Object.keys(DIALOGS).forEach((id) => enhanceDialog(document.getElementById(id)));
    enhanceLiveRegions();
  }

  function rememberDialogOpener(event) {
    if (lifecycleFrozen) return;
    const button = event.target?.closest?.("#v011TripModeButton,#v011AlertSettingsButton,#v011TripSettings");
    if (!button) return;
    const dialogId = button.id === "v011TripModeButton" ? "v011TripDialog" : "v011SettingsDialog";
    OPENERS.set(dialogId, button);
    const generation = focusGeneration;
    if (focusFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(focusFrame);
    focusFrame = requestAnimationFrame(() => {
      focusFrame = 0;
      if (!ownsDocument(generation)) return;
      const dialog = document.getElementById(dialogId);
      if (!dialog?.open) return;
      enhanceDialog(dialog);
      enhanceLiveRegions();
      const close = dialog.querySelector(DIALOGS[dialogId]?.close || "button");
      focusSafely(close, generation);
    });
  }

  function freezeLifecycle() {
    lifecycleFrozen = true;
    focusGeneration += 1;
    OPENERS.clear();
    if (focusFrame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(focusFrame);
    focusFrame = 0;
  }

  function resumeLifecycle(event) {
    if (!event?.persisted && !lifecycleFrozen) return;
    lifecycleFrozen = false;
    focusGeneration += 1;
    enhance();
  }

  document.addEventListener("click", rememberDialogOpener, true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) enhance();
  });
  window.addEventListener("pagehide", freezeLifecycle);
  window.addEventListener("pageshow", resumeLifecycle);
  [
    "nvs-group-recommendations-rendered",
    "nvs-shared-live-change",
    "nvs-live-plan-synced",
    "nvs-shared-view-resumed",
    "load",
  ].forEach((name) => window.addEventListener(name, enhance));

  enhance();

  window.NVSAccessibility0111 = Object.freeze({ refresh: enhance });
})();
