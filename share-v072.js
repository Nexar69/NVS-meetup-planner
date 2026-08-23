(() => {
  const PLAN_PARAM = "plan";
  const GROUP_STORAGE_KEY = "meet-schwerin-group-v1";
  const APP_STORAGE_KEY = "nvs-meetup-planner-state-v2";
  const OPT_STORAGE_KEY = "meet-schwerin-optimization-v2";
  const TIMING_STORAGE_KEY = "meet-schwerin-timing-v1";
  const MAX_PEOPLE = 6;
  const FALLBACK_COLORS = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];

  const personASelect = document.getElementById("personA");
  const personBSelect = document.getElementById("personB");
  const destinationSelect = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const results = document.getElementById("results");
  const meetupMap = document.getElementById("meetupMap");
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let restoreTimer = null;
  let restoredStorage = false;
  let sharedPlan = null;
  let originalStorage = null;
  let decorationTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function encodePayload(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  function decodePayload(value) {
    if (!value || value.length > 16000) return null;
    try {
      const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function cleanColor(value, index = 0) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function cleanPlace(value, fallbackLabel) {
    const lat = Number(value?.lat);
    const lon = Number(value?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      label: String(value?.label || fallbackLabel || "Shared place").slice(0, 100),
      lat,
      lon,
    };
  }

  function validateSharedPlan(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.members)) return null;
    const members = raw.members.slice(0, MAX_PEOPLE).map((member, index) => {
      const origin = cleanPlace(member?.origin, `Person ${index + 1} start`);
      if (!origin) return null;
      return {
        name: String(member?.name || `Person ${index + 1}`).slice(0, 24),
        color: cleanColor(member?.color, index),
        origin,
      };
    }).filter(Boolean);
    if (members.length < 2) return null;

    const destination = cleanPlace(raw.destination, "Shared meetup");
    if (!destination) return null;
    const focus = Number.isInteger(raw.focus) && raw.focus >= 0 && raw.focus < members.length ? raw.focus : -1;
    const priority = Array.isArray(raw.priority)
      ? [...new Set(raw.priority.filter((index) => Number.isInteger(index) && index >= 0 && index < members.length))]
      : [];
    const mode = ["together", "fastest", "easy"].includes(raw.mode) ? raw.mode : "together";
    const timing = ["target", "asap"].includes(raw.timing) ? raw.timing : "target";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : "";
    const time = /^\d{2}:\d{2}$/.test(raw.time || "") ? raw.time : "";

    return {
      v: 1,
      view: raw.view === "person" && focus >= 0 ? "person" : "group",
      focus,
      members,
      destination,
      priority,
      mode,
      timing,
      date,
      time,
      createdAt: Number(raw.createdAt) || null,
    };
  }

  function storageSnapshot() {
    const keys = [GROUP_STORAGE_KEY, APP_STORAGE_KEY, OPT_STORAGE_KEY, TIMING_STORAGE_KEY];
    const snapshot = {};
    try {
      keys.forEach((key) => { snapshot[key] = localStorage.getItem(key); });
    } catch {
      keys.forEach((key) => { snapshot[key] = null; });
    }
    return snapshot;
  }

  function restoreStorage() {
    if (!originalStorage || restoredStorage) return;
    restoredStorage = true;
    clearTimeout(restoreTimer);
    try {
      Object.entries(originalStorage).forEach(([key, value]) => {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
    } catch {
      // Viewer mode still works when storage is unavailable.
    }
  }

  function addSharedPlace(place, key, targets = []) {
    try {
      return window.NVSPlaces?.registerPlace?.(
        { key, label: place.label, lat: place.lat, lon: place.lon, source: "shared-plan" },
        { persist: false, targets },
      );
    } catch {
      return null;
    }
  }

  function bootstrapSharedPlan() {
    const params = new URLSearchParams(window.location.search);
    const plan = validateSharedPlan(decodePayload(params.get(PLAN_PARAM)));
    if (!plan) return null;

    originalStorage = storageSnapshot();
    document.body.classList.add("shared-viewer");
    document.body.dataset.sharedView = plan.view;
    if (plan.focus >= 0) document.body.dataset.sharedFocus = String(plan.focus);

    const ids = plan.members.map((_, index) => index === 0 ? "personA" : index === 1 ? "personB" : `shared-person-${index + 1}`);
    const origins = plan.members.map((member, index) => {
      const key = `shared-origin-${index + 1}`;
      const targets = index === 0 ? [personASelect] : index === 1 ? [personBSelect] : [];
      addSharedPlace(member.origin, key, targets);
      return key;
    });
    const destinationKey = "shared-destination";
    addSharedPlace(plan.destination, destinationKey, [destinationSelect]);

    if (personASelect) personASelect.value = origins[0];
    if (personBSelect) personBSelect.value = origins[1];
    if (destinationSelect) destinationSelect.value = destinationKey;
    if (plan.date && dateInput) dateInput.value = plan.date;
    if (plan.time && timeInput) timeInput.value = plan.time;

    const members = plan.members.map((member, index) => ({
      id: ids[index],
      name: member.name,
      color: member.color,
      base: index < 2,
      originKey: index < 2 ? undefined : origins[index],
    }));
    const priorityIds = plan.priority.map((index) => ids[index]).filter(Boolean);

    try {
      localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify({
        members,
        order: ids,
        priorityIds,
      }));
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify({
        personA: origins[0],
        personB: origins[1],
        destination: destinationKey,
        date: plan.date,
        time: plan.time,
      }));
      localStorage.setItem(OPT_STORAGE_KEY, plan.mode);
      localStorage.setItem(TIMING_STORAGE_KEY, plan.timing);
    } catch {
      // Shared plans can still work without persistence in many browsers.
    }

    restoreTimer = setTimeout(restoreStorage, 8000);
    return plan;
  }

  sharedPlan = bootstrapSharedPlan();

  function locationFor(key) {
    return window.NVSTransit?.LOCATIONS?.[key] || null;
  }

  function payloadFromCurrent(focusIndex = -1) {
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    const primary = recommendations?.primary;
    const assignments = Array.isArray(primary?.assignments) ? primary.assignments : [];
    if (assignments.length < 2) return null;

    const members = assignments.map((assignment, index) => {
      const place = locationFor(assignment.member?.originKey || assignment.route?.origin);
      if (!place) return null;
      return {
        name: String(assignment.member?.name || `Person ${index + 1}`).slice(0, 24),
        color: cleanColor(assignment.member?.color, index),
        origin: {
          label: String(place.label || assignment.member?.originKey || "Start").slice(0, 100),
          lat: Number(place.lat),
          lon: Number(place.lon),
        },
      };
    });
    if (members.some((member) => !member)) return null;

    const destination = locationFor(destinationSelect?.value);
    if (!destination) return null;
    const priorityIds = window.NVSGroup?.getPriorityIds?.() || [];
    const priority = assignments
      .map((assignment, index) => priorityIds.includes(assignment.member.id) ? index : -1)
      .filter((index) => index >= 0);

    return {
      v: 1,
      view: focusIndex >= 0 ? "person" : "group",
      focus: focusIndex,
      members,
      destination: {
        label: String(destination.label || destinationSelect.value).slice(0, 100),
        lat: Number(destination.lat),
        lon: Number(destination.lon),
      },
      priority,
      mode: recommendations.mode || window.NVSRecommend?.getMode?.() || "together",
      timing: recommendations.timingMode || window.NVSRecommend?.getTimingMode?.() || "target",
      date: dateInput?.value || "",
      time: timeInput?.value || "",
      createdAt: Date.now(),
    };
  }

  function buildShareUrl(focusIndex = -1) {
    const payload = payloadFromCurrent(focusIndex);
    if (!payload) return null;
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(PLAN_PARAM, encodePayload(payload));
    return { url: url.toString(), payload };
  }

  function ensureShareDialog() {
    let dialog = document.getElementById("groupShareDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "groupShareDialog";
    dialog.className = "group-share-dialog";
    dialog.innerHTML = `
      <div class="group-share-head">
        <div><p class="section-kicker">Share plan</p><h2 id="groupShareTitle">Share group map</h2></div>
        <button type="button" class="group-share-close" aria-label="Close">×</button>
      </div>
      <div class="group-share-copy" id="groupShareCopy"></div>
      <div class="group-share-actions">
        <button type="button" class="secondary-button group-share-cancel">Cancel</button>
        <button type="button" class="search-button group-share-confirm"><span>Share read-only link</span><span aria-hidden="true">↗</span></button>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector(".group-share-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector(".group-share-cancel")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  async function deliverShare(focusIndex = -1) {
    const built = buildShareUrl(focusIndex);
    if (!built) {
      showToast("Find a live group recommendation before sharing it.");
      return;
    }

    const person = focusIndex >= 0 ? built.payload.members[focusIndex] : null;
    const text = person
      ? `${person.name}'s read-only Meet Schwerin route to ${built.payload.destination.label}.`
      : `Read-only Meet Schwerin group plan to ${built.payload.destination.label}.`;

    try {
      if (navigator.share) {
        await navigator.share({ title: person ? `${person.name} · Meet Schwerin` : "Meet Schwerin group plan", text, url: built.url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(built.url);
        showToast(person ? `${person.name}'s link copied.` : "Read-only group link copied.");
      } else {
        window.prompt("Copy this link:", built.url);
      }
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Could not share the link.");
    }
  }

  function confirmShare(focusIndex = -1) {
    if (sharedPlan) return;
    const built = buildShareUrl(focusIndex);
    if (!built) {
      showToast("Find a live group recommendation before sharing it.");
      return;
    }
    const dialog = ensureShareDialog();
    const person = focusIndex >= 0 ? built.payload.members[focusIndex] : null;
    const title = dialog.querySelector("#groupShareTitle");
    const copy = dialog.querySelector("#groupShareCopy");
    const confirm = dialog.querySelector(".group-share-confirm");
    if (title) title.textContent = person ? `Share ${person.name}'s view` : "Share whole group map";
    if (copy) {
      copy.innerHTML = person
        ? `<p>This opens a <strong>read-only personal view</strong> with ${escapeHtml(person.name)} highlighted.</p><p class="group-share-warning">To rebuild ★ join points, the link contains the group names, starting locations, meetup place/time and route preferences.</p>`
        : `<p>This opens the complete group map and recommendation in a <strong>read-only viewer</strong>.</p><p class="group-share-warning">The link contains everyone's names and starting locations, plus the meetup place/time and route preferences.</p>`;
    }
    if (confirm) {
      confirm.onclick = async () => {
        dialog.close();
        await deliverShare(focusIndex);
      };
    }
    dialog.showModal();
  }

  function replaceTopShareButton() {
    const existing = document.getElementById("shareMeetupButton");
    if (!existing) return;
    if (sharedPlan) {
      existing.hidden = true;
      return;
    }
    const button = existing.cloneNode(true);
    existing.replaceWith(button);
    button.setAttribute("aria-label", "Share read-only group plan");
    const label = button.querySelector(".share-label");
    if (label) label.textContent = "Share group";
    button.addEventListener("click", () => confirmShare(-1));
  }

  function decorateResultCards() {
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    if (!recommendations || !results) return;

    [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
      const group = recommendations[card.dataset.mapPair];
      const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
      const rows = [...card.querySelectorAll(".group-card-person")];
      rows.forEach((row, index) => {
        const assignment = assignments[index];
        if (!assignment) return;
        row.dataset.shareMemberIndex = String(index);
        row.dataset.shareMemberId = assignment.member.id;

        if (!sharedPlan && !row.querySelector(".person-share-link")) {
          const duration = row.querySelector(".group-person-duration");
          if (duration) {
            const side = document.createElement("div");
            side.className = "group-person-side";
            duration.replaceWith(side);
            side.appendChild(duration);
            const share = document.createElement("button");
            share.type = "button";
            share.className = "person-share-link";
            share.innerHTML = `<span aria-hidden="true">↗</span><span>Link</span>`;
            share.setAttribute("aria-label", `Share ${assignment.member.name}'s route`);
            share.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              confirmShare(index);
            });
            side.appendChild(share);
          }
        }
      });
    });

    applyPersonalFocus();
  }

  function applyNumberedMarkers() {
    if (!meetupMap) return;
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    const count = recommendations?.primary?.assignments?.length || window.NVSGroup?.getMembers?.()?.length || 2;
    const markers = [...meetupMap.querySelectorAll(".meet-marker:not(.meet)")].slice(0, count);
    markers.forEach((marker, index) => {
      marker.textContent = String(index + 1);
      marker.closest(".leaflet-marker-icon")?.setAttribute("data-share-member-index", String(index));
    });

    if (sharedPlan?.view === "person" && sharedPlan.focus >= 0) {
      markers.forEach((marker, index) => {
        const wrapper = marker.closest(".leaflet-marker-icon");
        wrapper?.classList.toggle("shared-map-focus", index === sharedPlan.focus);
        wrapper?.classList.toggle("shared-map-muted", index !== sharedPlan.focus);
      });

      const paths = [...meetupMap.querySelectorAll(".leaflet-overlay-pane path")];
      paths.slice(0, count).forEach((path, index) => {
        path.style.opacity = index === sharedPlan.focus ? "1" : "0.16";
        path.style.filter = index === sharedPlan.focus ? "drop-shadow(0 0 2px rgba(16,24,40,.25))" : "none";
      });
    }
  }

  function applyPersonalFocus() {
    if (!sharedPlan || sharedPlan.view !== "person" || sharedPlan.focus < 0) return;
    const focus = sharedPlan.focus;

    document.querySelectorAll(".group-card-person").forEach((row) => {
      const index = Number(row.dataset.shareMemberIndex);
      row.classList.toggle("shared-person-focus", index === focus);
      row.classList.toggle("shared-person-muted", Number.isFinite(index) && index !== focus);
    });

    const boardRows = [...document.querySelectorAll("#departurePeople .departure-person")];
    boardRows.forEach((row, index) => {
      row.classList.toggle("shared-person-focus", index === focus);
      row.classList.toggle("shared-person-muted", index !== focus);
    });

    document.querySelectorAll(".journey-timeline-grid").forEach((grid) => {
      [...grid.querySelectorAll(":scope > .route-timeline")].forEach((timeline, index) => {
        timeline.classList.toggle("shared-person-focus", index === focus);
        timeline.classList.toggle("shared-person-muted", index !== focus);
      });
    });
    applyNumberedMarkers();
  }

  function ensureViewerBanner() {
    if (!sharedPlan || document.getElementById("sharedViewerBanner")) return;
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const person = sharedPlan.focus >= 0 ? sharedPlan.members[sharedPlan.focus] : null;
    const banner = document.createElement("section");
    banner.id = "sharedViewerBanner";
    banner.className = "shared-viewer-banner";
    banner.innerHTML = `
      <div>
        <span class="shared-viewer-lock">🔒 Read-only shared plan</span>
        <strong>${person ? `${escapeHtml(person.name)}'s personal view` : "Whole group view"}</strong>
        <small>${person ? "Their route is highlighted; the rest of the group stays visible for join context." : "Everyone's live routes, ★ joins and meetup timing are visible but cannot be edited."}</small>
      </div>
      <a class="shared-viewer-exit" href="${escapeHtml(window.location.pathname)}">Open planner</a>
    `;
    hero.insertAdjacentElement("afterend", banner);
  }

  function scheduleDecorations() {
    clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
      decorateResultCards();
      applyNumberedMarkers();
      applyPersonalFocus();
      const version = document.getElementById("versionLabel");
      if (version) version.textContent = "v0.7.2 · Read-only group & personal sharing";
    }, 35);
  }

  replaceTopShareButton();
  ensureViewerBanner();
  scheduleDecorations();

  window.addEventListener("nvs-group-recommendations-rendered", () => {
    if (sharedPlan) restoreStorage();
    scheduleDecorations();
  });
  window.addEventListener("nvs-group-change", scheduleDecorations);
  window.addEventListener("nvs-priority-change", scheduleDecorations);
  window.addEventListener("nvs-timing-change", scheduleDecorations);
  window.addEventListener("load", scheduleDecorations);
  window.addEventListener("beforeunload", restoreStorage);

  if (results) new MutationObserver(scheduleDecorations).observe(results, { childList: true, subtree: true });
  if (meetupMap) new MutationObserver(() => {
    clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
      applyNumberedMarkers();
      applyPersonalFocus();
    }, 20);
  }).observe(meetupMap, { childList: true, subtree: true });

  window.NVSShare = Object.freeze({
    isViewer: () => Boolean(sharedPlan),
    getSharedPlan: () => sharedPlan,
    getFocusIndex: () => sharedPlan?.focus ?? -1,
    shareGroup: () => confirmShare(-1),
    sharePerson: (index) => confirmShare(Number(index)),
    buildShareUrl: (index = -1) => buildShareUrl(Number(index)),
  });
})();