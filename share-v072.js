(() => {
  const PLAN_PARAM = "plan";
  const GROUP_KEY = "meet-schwerin-group-v1";
  const APP_KEY = "nvs-meetup-planner-state-v2";
  const OPT_KEY = "meet-schwerin-optimization-v2";
  const TIMING_KEY = "meet-schwerin-timing-v1";
  const STORAGE_KEYS = [GROUP_KEY, APP_KEY, OPT_KEY, TIMING_KEY];
  const COLORS = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];
  const config = window.NVSConfig || {};

  const personA = document.getElementById("personA");
  const personB = document.getElementById("personB");
  const destination = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  const results = document.getElementById("results");
  const toast = document.getElementById("toast");

  let toastTimer = null;
  let decorationTimer = null;
  let restoreTimer = null;
  let originalStorage = null;
  let restored = false;
  let shortPlanCache = null;

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

  function encode(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
  }

  function decode(value) {
    if (!value || value.length > 16000) return null;
    try {
      const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function validColor(value, index) {
    const color = String(value || "").trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : COLORS[index % COLORS.length];
  }

  function validPlace(place, fallback) {
    const lat = Number(place?.lat);
    const lon = Number(place?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { label: String(place?.label || fallback).slice(0, 100), lat, lon };
  }

  function validatePlan(raw) {
    if (!raw || raw.v !== 1 || !Array.isArray(raw.members)) return null;
    const members = raw.members.slice(0, 6).map((member, index) => {
      const origin = validPlace(member?.origin, `Person ${index + 1} start`);
      return origin ? {
        name: String(member?.name || `Person ${index + 1}`).slice(0, 24),
        color: validColor(member?.color, index),
        origin,
      } : null;
    }).filter(Boolean);
    if (members.length < 2) return null;
    const meet = validPlace(raw.destination, "Shared meetup");
    if (!meet) return null;
    const focus = Number.isInteger(raw.focus) && raw.focus >= 0 && raw.focus < members.length ? raw.focus : -1;
    return {
      v: 1,
      view: raw.view === "person" && focus >= 0 ? "person" : "group",
      focus,
      members,
      destination: meet,
      priority: Array.isArray(raw.priority) ? [...new Set(raw.priority.filter((i) => Number.isInteger(i) && i >= 0 && i < members.length))] : [],
      mode: ["together", "fastest", "easy"].includes(raw.mode) ? raw.mode : "together",
      timing: ["target", "asap"].includes(raw.timing) ? raw.timing : "target",
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || "") ? raw.date : "",
      time: /^\d{2}:\d{2}$/.test(raw.time || "") ? raw.time : "",
    };
  }

  function snapshotStorage() {
    const value = {};
    try { STORAGE_KEYS.forEach((key) => { value[key] = localStorage.getItem(key); }); }
    catch { STORAGE_KEYS.forEach((key) => { value[key] = null; }); }
    return value;
  }

  function restoreStorage() {
    if (!originalStorage || restored) return;
    restored = true;
    clearTimeout(restoreTimer);
    try {
      Object.entries(originalStorage).forEach(([key, value]) => {
        if (value == null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
    } catch {}
  }

  function registerShared(place, key, targets = []) {
    try {
      return window.NVSPlaces?.registerPlace?.(
        { key, label: place.label, lat: place.lat, lon: place.lon, source: "shared-plan" },
        { persist: false, targets },
      );
    } catch {
      return null;
    }
  }

  function bootstrap() {
    const injected = window.__NVS_SHORT_PLAN__ || null;
    const encoded = decode(new URLSearchParams(window.location.search).get(PLAN_PARAM));
    const plan = validatePlan(injected || encoded);
    if (!plan) return null;
    originalStorage = snapshotStorage();
    document.body.classList.add("shared-viewer");
    document.body.dataset.sharedView = plan.view;
    if (plan.focus >= 0) document.body.dataset.sharedFocus = String(plan.focus);

    const ids = plan.members.map((_, index) => index === 0 ? "personA" : index === 1 ? "personB" : `shared-person-${index + 1}`);
    const originKeys = plan.members.map((member, index) => {
      const key = `shared-origin-${index + 1}`;
      registerShared(member.origin, key, index === 0 ? [personA] : index === 1 ? [personB] : []);
      return key;
    });
    const destinationKey = "shared-destination";
    registerShared(plan.destination, destinationKey, [destination]);

    if (personA) personA.value = originKeys[0];
    if (personB) personB.value = originKeys[1];
    if (destination) destination.value = destinationKey;
    if (plan.date && dateInput) dateInput.value = plan.date;
    if (plan.time && timeInput) timeInput.value = plan.time;

    const members = plan.members.map((member, index) => ({
      id: ids[index], name: member.name, color: member.color, base: index < 2,
      originKey: index < 2 ? undefined : originKeys[index],
    }));
    const priorityIds = plan.priority.map((index) => ids[index]).filter(Boolean);

    try {
      localStorage.setItem(GROUP_KEY, JSON.stringify({ members, order: ids, priorityIds }));
      localStorage.setItem(APP_KEY, JSON.stringify({ personA: originKeys[0], personB: originKeys[1], destination: destinationKey, date: plan.date, time: plan.time }));
      localStorage.setItem(OPT_KEY, plan.mode);
      localStorage.setItem(TIMING_KEY, plan.timing);
    } catch {}
    restoreTimer = setTimeout(restoreStorage, 8000);
    return plan;
  }

  const sharedPlan = bootstrap();

  function locationFor(key) {
    return window.NVSTransit?.LOCATIONS?.[key] || null;
  }

  function currentPayload(focus = -1) {
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    const assignments = Array.isArray(recommendations?.primary?.assignments) ? recommendations.primary.assignments : [];
    if (assignments.length < 2) return null;

    const members = assignments.map((assignment, index) => {
      const place = locationFor(assignment.member?.originKey || assignment.route?.origin);
      if (!place) return null;
      return {
        name: String(assignment.member?.name || `Person ${index + 1}`).slice(0, 24),
        color: validColor(assignment.member?.color, index),
        origin: { label: String(place.label || "Start").slice(0, 100), lat: Number(place.lat), lon: Number(place.lon) },
      };
    });
    if (members.some((member) => !member)) return null;

    const meet = locationFor(destination?.value);
    if (!meet) return null;
    const priorityIds = window.NVSGroup?.getPriorityIds?.() || [];
    const priority = assignments.map((assignment, index) => priorityIds.includes(assignment.member.id) ? index : -1).filter((index) => index >= 0);

    return {
      v: 1,
      view: focus >= 0 ? "person" : "group",
      focus,
      members,
      destination: { label: String(meet.label || destination.value).slice(0, 100), lat: Number(meet.lat), lon: Number(meet.lon) },
      priority,
      mode: recommendations.mode || window.NVSRecommend?.getMode?.() || "together",
      timing: recommendations.timingMode || window.NVSRecommend?.getTimingMode?.() || "target",
      date: dateInput?.value || "",
      time: timeInput?.value || "",
      createdAt: Date.now(),
    };
  }

  function buildShareUrl(focus = -1) {
    const payload = currentPayload(focus);
    if (!payload) return null;
    const url = new URL(config.appUrl || window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set(PLAN_PARAM, encode(payload));
    return { url: url.toString(), payload, short: false };
  }

  function planSignature(plan) {
    return JSON.stringify({
      members: plan.members,
      destination: plan.destination,
      priority: plan.priority,
      mode: plan.mode,
      timing: plan.timing,
      date: plan.date,
      time: plan.time,
    });
  }

  async function ensureShortPlan() {
    if (!config.backendUrl) return null;
    const payload = currentPayload(-1);
    if (!payload) return null;
    const signature = planSignature(payload);
    if (shortPlanCache?.signature === signature) return shortPlanCache;

    const response = await fetch(`${config.backendUrl}/api/plans`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
      body: JSON.stringify({ plan: payload }),
    });
    if (!response.ok) throw new Error(`SHORT_LINK_HTTP_${response.status}`);
    const data = await response.json();
    if (!data?.id || !data?.url) throw new Error("SHORT_LINK_BAD_RESPONSE");
    shortPlanCache = { signature, id: data.id, url: data.url, expiresIn: data.expiresIn || config.shareTtlSeconds || 259200 };
    return shortPlanCache;
  }

  async function buildBestShareUrl(focus = -1) {
    const fallback = buildShareUrl(focus);
    if (!fallback || !config.backendUrl) return fallback;
    try {
      const stored = await ensureShortPlan();
      if (!stored) return fallback;
      const url = new URL(stored.url);
      if (focus >= 0) url.searchParams.set("me", String(focus + 1));
      return { url: url.toString(), payload: fallback.payload, short: true, expiresIn: stored.expiresIn };
    } catch (error) {
      console.warn("Short-link backend unavailable; using encoded link:", error);
      return fallback;
    }
  }

  function shareDialog() {
    let dialog = document.getElementById("groupShareDialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "groupShareDialog";
    dialog.className = "group-share-dialog";
    dialog.innerHTML = `
      <div class="group-share-head"><div><p class="section-kicker">Share plan</p><h2 id="groupShareTitle">Share group map</h2></div><button type="button" class="group-share-close" aria-label="Close">×</button></div>
      <div class="group-share-copy" id="groupShareCopy"></div>
      <div class="group-share-actions"><button type="button" class="secondary-button group-share-cancel">Cancel</button><button type="button" class="search-button group-share-confirm"><span>Share read-only link</span><span aria-hidden="true">↗</span></button></div>`;
    document.body.appendChild(dialog);
    dialog.querySelector(".group-share-close")?.addEventListener("click", () => dialog.close());
    dialog.querySelector(".group-share-cancel")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  async function deliver(focus = -1) {
    const built = await buildBestShareUrl(focus);
    if (!built) { showToast("Find a live group recommendation before sharing it."); return; }
    const person = focus >= 0 ? built.payload.members[focus] : null;
    const text = person ? `${person.name}'s read-only Meet Schwerin route to ${built.payload.destination.label}.` : `Read-only Meet Schwerin group plan to ${built.payload.destination.label}.`;
    try {
      if (navigator.share) await navigator.share({ title: person ? `${person.name} · Meet Schwerin` : "Meet Schwerin group plan", text, url: built.url });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(built.url);
        showToast(built.short ? (person ? `${person.name}'s short link copied.` : "Short group link copied.") : "Link copied.");
      } else window.prompt("Copy this link:", built.url);
    } catch (error) {
      if (error?.name !== "AbortError") showToast("Could not share the link.");
    }
  }

  function confirmShare(focus = -1) {
    if (sharedPlan) return;
    const built = buildShareUrl(focus);
    if (!built) { showToast("Find a live group recommendation before sharing it."); return; }
    const dialog = shareDialog();
    const person = focus >= 0 ? built.payload.members[focus] : null;
    const expiry = config.backendUrl ? `<p><strong>Short link:</strong> stored for about 72 hours, then it expires automatically.</p>` : `<p><strong>Fallback mode:</strong> the plan is encoded directly in the URL until the short-link backend is configured.</p>`;
    dialog.querySelector("#groupShareTitle").textContent = person ? `Share ${person.name}'s view` : "Share whole group map";
    dialog.querySelector("#groupShareCopy").innerHTML = person
      ? `<p>This opens a <strong>read-only personal view</strong> for ${escapeHtml(person.name)}.</p>${expiry}<p class="group-share-warning">The shared plan contains group names, starting locations, meetup place/time and route preferences so ★ joins can be rebuilt.</p>`
      : `<p>This opens the complete group map and recommendation in a <strong>read-only viewer</strong>.</p>${expiry}<p class="group-share-warning">The shared plan contains everyone's names and starting locations, plus the meetup place/time and route preferences.</p>`;
    dialog.querySelector(".group-share-confirm").onclick = async () => { dialog.close(); await deliver(focus); };
    dialog.showModal();
  }

  function replaceTopShare() {
    const existing = document.getElementById("shareMeetupButton");
    if (!existing) return;
    if (sharedPlan) { existing.hidden = true; return; }
    const button = existing.cloneNode(true);
    existing.replaceWith(button);
    button.setAttribute("aria-label", "Share read-only group plan");
    const label = button.querySelector(".share-label");
    if (label) label.textContent = "Share group";
    button.addEventListener("click", () => confirmShare(-1));
  }

  function decorateCards() {
    const rec = window.__NVS_LAST_RECOMMENDATIONS__;
    if (!rec || !results) return;
    [...results.querySelectorAll(":scope > .result[data-map-pair]")].forEach((card) => {
      const group = rec[card.dataset.mapPair];
      const assignments = Array.isArray(group?.assignments) ? group.assignments : [];
      [...card.querySelectorAll(".group-card-person")].forEach((row, index) => {
        const assignment = assignments[index];
        if (!assignment) return;
        row.dataset.shareMemberIndex = String(index);
        row.dataset.shareMemberId = assignment.member.id;
        if (sharedPlan || card.dataset.mapPair !== "primary" || row.querySelector(".person-share-link")) return;
        const duration = row.querySelector(".group-person-duration");
        if (!duration) return;
        const side = document.createElement("div");
        side.className = "group-person-side";
        duration.replaceWith(side);
        side.appendChild(duration);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "person-share-link";
        button.innerHTML = `<span aria-hidden="true">↗</span><span>Link</span>`;
        button.setAttribute("aria-label", `Share ${assignment.member.name}'s route`);
        button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); confirmShare(index); });
        side.appendChild(button);
      });
    });
  }

  function personalFocus() {
    if (!sharedPlan || sharedPlan.view !== "person") return;
    const focus = sharedPlan.focus;
    document.querySelectorAll(".group-card-person").forEach((row) => {
      const index = Number(row.dataset.shareMemberIndex);
      row.classList.toggle("shared-person-focus", index === focus);
      row.classList.toggle("shared-person-muted", Number.isFinite(index) && index !== focus);
    });
    [...document.querySelectorAll("#departurePeople .departure-person")].forEach((row, index) => {
      row.classList.toggle("shared-person-focus", index === focus);
      row.classList.toggle("shared-person-muted", index !== focus);
    });
    document.querySelectorAll(".journey-timeline-grid").forEach((grid) => {
      [...grid.querySelectorAll(":scope > .route-timeline")].forEach((timeline, index) => {
        timeline.classList.toggle("shared-person-focus", index === focus);
        timeline.classList.toggle("shared-person-muted", index !== focus);
      });
    });
  }

  function viewerBanner() {
    if (!sharedPlan || document.getElementById("sharedViewerBanner")) return;
    const hero = document.querySelector(".hero");
    if (!hero) return;
    const person = sharedPlan.focus >= 0 ? sharedPlan.members[sharedPlan.focus] : null;
    const banner = document.createElement("section");
    banner.id = "sharedViewerBanner";
    banner.className = "shared-viewer-banner";
    const plannerUrl = window.__NVS_APP_URL__ || config.appUrl || "/";
    banner.innerHTML = `<div><span class="shared-viewer-lock">🔒 Read-only shared plan</span><strong>${person ? `${escapeHtml(person.name)}'s personal view` : "Whole group view"}</strong><small>${person ? "Their route is highlighted; the rest of the group stays visible for join context." : "Everyone's live routes, ★ joins and meetup timing are visible but cannot be edited."}</small></div><a class="shared-viewer-exit" href="${escapeHtml(plannerUrl)}">Open planner</a>`;
    hero.insertAdjacentElement("afterend", banner);
  }

  function decorate() {
    clearTimeout(decorationTimer);
    decorationTimer = setTimeout(() => {
      decorateCards();
      personalFocus();
      const version = document.getElementById("versionLabel");
      if (version) version.textContent = "v0.8 · VMV routing + short share links";
    }, 35);
  }

  replaceTopShare();
  viewerBanner();
  decorate();

  window.addEventListener("nvs-group-recommendations-rendered", () => { if (sharedPlan) restoreStorage(); decorate(); });
  window.addEventListener("nvs-group-change", () => { shortPlanCache = null; decorate(); });
  window.addEventListener("nvs-priority-change", () => { shortPlanCache = null; decorate(); });
  window.addEventListener("nvs-timing-change", () => { shortPlanCache = null; decorate(); });
  window.addEventListener("load", decorate);
  window.addEventListener("beforeunload", restoreStorage);
  if (results) new MutationObserver(decorate).observe(results, { childList: true, subtree: true });

  window.NVSShare = Object.freeze({
    isViewer: () => Boolean(sharedPlan),
    getSharedPlan: () => sharedPlan,
    getFocusIndex: () => sharedPlan?.focus ?? -1,
    shareGroup: () => confirmShare(-1),
    sharePerson: (index) => confirmShare(Number(index)),
    buildShareUrl: (index = -1) => buildShareUrl(Number(index)),
    buildBestShareUrl: (index = -1) => buildBestShareUrl(Number(index)),
  });
})();
