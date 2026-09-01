(() => {
  const config = window.NVSConfig || {};
  const destinationInput = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  let secureCache = null;
  let sharing = false;
  let rotating = false;
  let pendingShare = null;
  let syncTimer = null;
  let syncGeneration = 0;
  let activePlanSync = null;
  let createGeneration = 0;
  let activeSecureCreate = null;
  let rotateGeneration = 0;
  let activeCapabilityRotation = null;
  let deliveryGeneration = 0;
  let activeDeliverySignature = null;
  let lifecycleFrozen = false;

  function ownsLifecycle() {
    return !lifecycleFrozen && !document.hidden;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function locationFor(key) {
    return window.NVSTransit?.LOCATIONS?.[key] || null;
  }

  function validColor(value, index) {
    const color = String(value || "").trim();
    const fallback = ["#2563eb", "#db2777", "#7c3aed", "#ea580c", "#0891b2", "#65a30d"];
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback[index % fallback.length];
  }

  function payload() {
    const recommendations = window.__NVS_LAST_RECOMMENDATIONS__;
    const assignments = Array.isArray(recommendations?.primary?.assignments) ? recommendations.primary.assignments : [];
    if (assignments.length < 2) return null;

    const members = assignments.map((assignment, index) => {
      const key = assignment?.member?.originKey || assignment?.route?.origin;
      const place = locationFor(key);
      if (!place) return null;
      return {
        name: String(assignment?.member?.name || `Person ${index + 1}`).slice(0, 24),
        color: validColor(assignment?.member?.color, index),
        origin: {
          label: String(place.label || "Start").slice(0, 100),
          lat: Number(place.lat),
          lon: Number(place.lon),
        },
      };
    });
    if (members.some((member) => !member)) return null;

    const destination = locationFor(destinationInput?.value);
    if (!destination) return null;
    const priorityIds = window.NVSGroup?.getPriorityIds?.() || [];
    const priority = assignments
      .map((assignment, index) => priorityIds.includes(assignment.member.id) ? index : -1)
      .filter((index) => index >= 0);
    const timing = recommendations.timingMode || window.NVSRecommend?.getTimingMode?.() || "target";

    return {
      v: 1,
      view: "group",
      focus: -1,
      members,
      destination: {
        label: String(destination.label || destinationInput.value).slice(0, 100),
        lat: Number(destination.lat),
        lon: Number(destination.lon),
      },
      priority,
      mode: recommendations.mode || window.NVSRecommend?.getMode?.() || "together",
      timing,
      // ASAP date/time are only a rolling routing anchor. Keeping them out of
      // the shared intent prevents pointless revisions as the clock advances.
      date: timing === "asap" ? "" : (dateInput?.value || ""),
      time: timing === "asap" ? "" : (timeInput?.value || ""),
      createdAt: Date.now(),
    };
  }

  function signature(plan) {
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

  function currentPlanSignature() {
    const plan = payload();
    return plan ? signature(plan) : null;
  }

  function identitySignature(plan) {
    return JSON.stringify((plan?.members || []).map((member) => String(member?.name || "")));
  }

  function cacheExpiresAt() {
    const value = Number(secureCache?.expiresAt);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function cacheExpired(now = Date.now()) {
    const expiry = cacheExpiresAt();
    return expiry != null && now >= expiry;
  }

  function beginDelivery(expectedSignature) {
    if (!ownsLifecycle() || sharing || !expectedSignature || currentPlanSignature() !== expectedSignature) return null;
    sharing = true;
    activeDeliverySignature = expectedSignature;
    const token = Object.freeze({ generation: ++deliveryGeneration, signature: expectedSignature });
    renderManagement();
    return token;
  }

  function deliveryIsCurrent(token) {
    return Boolean(
      ownsLifecycle()
      && token
      && token.generation === deliveryGeneration
      && token.signature === activeDeliverySignature
      && currentPlanSignature() === token.signature,
    );
  }

  function invalidateDelivery({ dismissDialog = false } = {}) {
    deliveryGeneration += 1;
    activeDeliverySignature = null;
    sharing = false;
    pendingShare = null;
    if (dismissDialog) {
      const element = document.getElementById("v010ShareDialog");
      if (element?.open) element.close();
    }
    renderManagement();
  }

  function cancelScheduledSync() {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  function invalidatePlanSync() {
    activePlanSync?.controller?.abort?.();
    syncGeneration += 1;
    activePlanSync = null;
  }

  function invalidateSecureCreate() {
    activeSecureCreate?.controller?.abort?.();
    createGeneration += 1;
    activeSecureCreate = null;
  }

  function invalidateCapabilityRotation() {
    activeCapabilityRotation?.controller?.abort?.();
    rotateGeneration += 1;
    activeCapabilityRotation = null;
    rotating = false;
  }

  function clearSecureCache(reason = "") {
    if (!secureCache) return;
    const id = secureCache.id;
    secureCache = null;
    cancelScheduledSync();
    invalidatePlanSync();
    invalidateCapabilityRotation();
    renderManagement();
    window.dispatchEvent(new CustomEvent("nvs-share-session-cleared", {
      detail: { id, reason: String(reason || "cleared") },
    }));
  }

  function pendingResetTarget() {
    if (pendingShare?.type !== "person" || !Number.isInteger(pendingShare.index)) return { member: null, name: "" };
    const member = payload()?.members?.[pendingShare.index];
    return { member: pendingShare.index, name: String(member?.name || `Person ${pendingShare.index + 1}`) };
  }

  function renderManagement() {
    const element = document.getElementById("v010ShareDialog");
    if (!element) return;
    const button = element.querySelector(".v010-share-revoke");
    const confirm = element.querySelector(".v010-share-confirm");
    const note = element.querySelector("#v010ShareSecurityNote");
    const target = pendingResetTarget();
    if (button) {
      button.hidden = !secureCache;
      button.disabled = rotating || sharing;
      button.textContent = rotating
        ? "Resetting…"
        : target.member == null
          ? "Reset all private links"
          : `Reset ${target.name}'s private link`;
    }
    if (confirm) {
      confirm.disabled = rotating || sharing;
      if (sharing) confirm.setAttribute("aria-busy", "true");
      else confirm.removeAttribute("aria-busy");
    }
    if (note) {
      note.hidden = !secureCache;
      note.textContent = !secureCache
        ? ""
        : target.member == null
          ? "Organizer control: resetting all private links makes every previously issued personal check-in link read-only. Existing visible check-in history is kept."
          : `Organizer control: resetting ${target.name}'s private link affects only that person's old write key. Other personal links and visible check-in history stay unchanged.`;
    }
  }

  async function syncExistingPlan(nextPlan, expectedSignature = null) {
    if (!ownsLifecycle() || !secureCache?.id || !secureCache?.ownerKey || !config.backendUrl) return false;
    if (cacheExpired()) {
      clearSecureCache("expired");
      return false;
    }

    const plan = nextPlan || payload();
    if (!plan) return false;
    const sig = signature(plan);
    if (expectedSignature && sig !== expectedSignature) return false;

    const identity = identitySignature(plan);
    if (identity !== secureCache.identity) {
      clearSecureCache("identity-changed");
      return false;
    }

    if (sig === secureCache.signature) return true;
    const session = secureCache;
    if (activePlanSync?.session === session && activePlanSync.signature === sig) {
      return activePlanSync.promise;
    }

    const generation = ++syncGeneration;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const promise = (async () => {
      if (!ownsLifecycle() || secureCache !== session || generation !== syncGeneration) return false;
      const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/live/${session.id}/plan`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ key: session.ownerKey, plan }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!ownsLifecycle() || secureCache !== session || generation !== syncGeneration || (expectedSignature && currentPlanSignature() !== expectedSignature)) return false;
      if (response.status === 404 || response.status === 409) {
        clearSecureCache(response.status === 404 ? "missing-or-expired" : "identity-changed");
        return false;
      }
      if (!response.ok) throw new Error(`LIVE_PLAN_SYNC_HTTP_${response.status}`);
      const data = await response.json();
      if (!ownsLifecycle() || secureCache !== session || generation !== syncGeneration || (expectedSignature && currentPlanSignature() !== expectedSignature)) return false;
      session.signature = sig;
      session.revision = Number(data?.revision) || session.revision || 1;
      const expiry = Number(data?.expiresAt);
      if (Number.isFinite(expiry) && expiry > 0) session.expiresAt = expiry;
      window.dispatchEvent(new CustomEvent("nvs-live-plan-synced", {
        detail: { id: session.id, revision: session.revision, expiresAt: cacheExpiresAt() },
      }));
      return true;
    })();

    activePlanSync = { session, signature: sig, generation, promise, controller };
    try {
      return await promise;
    } finally {
      if (activePlanSync?.generation === generation) activePlanSync = null;
    }
  }

  function scheduleSync() {
    cancelScheduledSync();
    if (!ownsLifecycle() || !secureCache) return;
    if (cacheExpired()) {
      clearSecureCache("expired");
      return;
    }
    syncTimer = setTimeout(() => {
      syncTimer = null;
      if (!ownsLifecycle()) return;
      syncExistingPlan().catch((error) => {
        if (error?.name !== "AbortError") console.warn("Shared live plan sync failed", error);
      });
    }, 700);
  }

  async function createSecurePlan(expectedSignature = null) {
    if (!ownsLifecycle()) return null;
    const plan = payload();
    if (!plan || !config.backendUrl) return null;
    const sig = signature(plan);
    if (expectedSignature && sig !== expectedSignature) return null;
    const identity = identitySignature(plan);

    if (cacheExpired()) clearSecureCache("expired");

    if (secureCache) {
      if (secureCache.identity !== identity) {
        clearSecureCache("identity-changed");
      } else {
        if (secureCache.signature !== sig) await syncExistingPlan(plan, expectedSignature);
        if (!ownsLifecycle()) return null;
        if (expectedSignature && currentPlanSignature() !== expectedSignature) return null;
        if (secureCache?.signature === sig && !cacheExpired()) return { ...secureCache, plan };
      }
    }

    const generation = ++createGeneration;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    activeSecureCreate = { generation, controller };
    try {
      if (!ownsLifecycle() || generation !== createGeneration) return null;
      const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/plans`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ plan }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!ownsLifecycle() || generation !== createGeneration) return null;
      if (!response.ok) throw new Error(`SECURE_SHARE_HTTP_${response.status}`);
      const data = await response.json();
      if (!ownsLifecycle() || generation !== createGeneration) return null;
      if (!data?.id || !data?.url || !data?.ownerKey || !Array.isArray(data.memberKeys) || data.memberKeys.length < plan.members.length) {
        throw new Error("SECURE_SHARE_CAPABILITIES_MISSING");
      }
      if (expectedSignature && currentPlanSignature() !== expectedSignature) return null;
      const expiry = Number(data?.expiresAt);
      invalidatePlanSync();
      secureCache = {
        id: data.id,
        identity,
        signature: sig,
        url: data.url,
        ownerKey: data.ownerKey,
        memberKeys: data.memberKeys,
        revision: Number(data.revision) || 1,
        expiresIn: data.expiresIn || 259200,
        expiresAt: Number.isFinite(expiry) && expiry > 0 ? expiry : null,
      };
      renderManagement();
      return { ...secureCache, plan };
    } finally {
      if (activeSecureCreate?.generation === generation) activeSecureCreate = null;
    }
  }

  async function rotateCapabilities(member = null) {
    if (!ownsLifecycle() || !secureCache?.id || !secureCache?.ownerKey || !config.backendUrl || rotating) return false;
    if (cacheExpired()) {
      clearSecureCache("expired");
      return false;
    }
    const session = secureCache;
    const generation = ++rotateGeneration;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    activeCapabilityRotation = { generation, controller, session };
    rotating = true;
    renderManagement();
    try {
      if (!ownsLifecycle() || generation !== rotateGeneration || secureCache !== session) return false;
      const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/live/${session.id}/capabilities`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ key: session.ownerKey, ...(Number.isInteger(member) ? { member } : {}) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!ownsLifecycle() || generation !== rotateGeneration || secureCache !== session) return false;
      if (response.status === 404) {
        clearSecureCache("missing-or-expired");
        return false;
      }
      if (!response.ok) throw new Error(`CAPABILITY_ROTATE_HTTP_${response.status}`);
      const data = await response.json();
      if (!ownsLifecycle() || generation !== rotateGeneration || secureCache !== session) return false;
      if (!Array.isArray(data?.memberKeys) || data.memberKeys.length !== session.memberKeys.length) {
        throw new Error("CAPABILITY_ROTATE_BAD_RESPONSE");
      }
      session.memberKeys = data.memberKeys;
      const expiry = Number(data?.expiresAt);
      if (Number.isFinite(expiry) && expiry > 0) session.expiresAt = expiry;
      window.dispatchEvent(new CustomEvent("nvs-share-capabilities-rotated", {
        detail: { id: session.id, member: Number.isInteger(member) ? member : null, expiresAt: cacheExpiresAt() },
      }));
      return true;
    } finally {
      if (activeCapabilityRotation?.generation === generation) {
        activeCapabilityRotation = null;
        rotating = false;
        if (ownsLifecycle()) renderManagement();
      }
    }
  }

  function dialog() {
    let element = document.getElementById("v010ShareDialog");
    if (element) return element;
    element = document.createElement("dialog");
    element.id = "v010ShareDialog";
    element.className = "group-share-dialog";
    element.innerHTML = `
      <div class="group-share-head">
        <div><p class="section-kicker">Share live plan</p><h2 id="v010ShareTitle">Share route</h2></div>
        <button type="button" class="group-share-close" aria-label="Close">×</button>
      </div>
      <div class="group-share-copy" id="v010ShareCopy"></div>
      <p class="group-share-warning" id="v010ShareSecurityNote" hidden></p>
      <div class="group-share-actions">
        <button type="button" class="secondary-button v010-share-revoke" hidden>Reset all private links</button>
        <button type="button" class="secondary-button v010-share-cancel">Cancel</button>
        <button type="button" class="search-button v010-share-confirm"><span>Share link</span><span aria-hidden="true">↗</span></button>
      </div>`;
    document.body.appendChild(element);
    element.querySelector(".group-share-close")?.addEventListener("click", () => element.close());
    element.querySelector(".v010-share-cancel")?.addEventListener("click", () => element.close());
    element.addEventListener("click", (event) => { if (event.target === element) element.close(); });
    element.addEventListener("close", () => {
      pendingShare = null;
      renderManagement();
    });
    element.querySelector(".v010-share-confirm")?.addEventListener("click", async () => {
      const action = pendingShare;
      pendingShare = null;
      element.close();
      if (!action) return;
      if (currentPlanSignature() !== action.signature) {
        window.alert("The meetup changed while Share was open. Open Share again to share the latest route.");
        return;
      }
      if (action.type === "group") await deliverGroup(action.signature);
      if (action.type === "person") await deliverPerson(action.index, action.signature);
    });
    element.querySelector(".v010-share-revoke")?.addEventListener("click", async () => {
      if (!secureCache || rotating) return;
      const target = pendingResetTarget();
      const confirmed = window.confirm(target.member == null
        ? "Reset every private personal check-in link for this meetup? Old personal links will stay readable but can no longer post status updates. Existing visible check-ins will remain."
        : `Reset ${target.name}'s private personal check-in link? Their old link will stay readable but can no longer post status updates. Other personal links stay valid.`);
      if (!confirmed) return;
      try {
        const changed = await rotateCapabilities(target.member);
        if (changed) {
          window.alert(target.member == null
            ? "All private check-in links reset. Share fresh personal links with anyone who should still be able to check in."
            : `${target.name}'s old private check-in link is now read-only. Share a fresh personal link with them to restore check-ins.`);
        } else if (!secureCache) {
          window.alert("That shared session has expired. Use Share again to create a fresh meetup link.");
        }
      } catch (error) {
        if (error?.name === "AbortError" || !ownsLifecycle()) return;
        console.warn("Private link reset failed", error);
        window.alert("Could not reset the private link. Check your connection and try again.");
      }
    });
    renderManagement();
    return element;
  }

  function confirmShare(type, index = -1) {
    if (!ownsLifecycle() || window.NVSShare?.isViewer?.()) return;
    const plan = payload();
    if (!plan) {
      window.alert("Find a live group recommendation before sharing it.");
      return;
    }
    if (cacheExpired()) clearSecureCache("expired");
    const element = dialog();
    const person = type === "person" ? plan.members[index] : null;
    pendingShare = { type, index, signature: signature(plan) };
    element.querySelector("#v010ShareTitle").textContent = person ? `Share ${person.name}'s live route` : "Share whole live meetup";
    element.querySelector("#v010ShareCopy").innerHTML = person
      ? `<p>This creates a <strong>read-only personal route</strong> for ${escapeHtml(person.name)} with a private check-in capability for that person only.</p><p class="group-share-warning">The link contains a random write key. Anyone you forward this exact personal link to can update ${escapeHtml(person.name)}'s voluntary meetup status until the backend-provided session deadline or you reset that person's private link.</p>`
      : `<p>This creates the <strong>read-only whole-group view</strong>. It can see voluntary check-ins but cannot post as any person.</p><p class="group-share-warning">The shared plan contains group names, starting locations, meetup place/time and route preferences. Its exact automatic expiry is set by the Meet Schwerin backend and shown in the shared view.</p>`;
    renderManagement();
    if (!element.open) element.showModal();
  }

  async function nativeShare({ title, text, url }, token) {
    if (!deliveryIsCurrent(token)) return false;
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return deliveryIsCurrent(token);
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      if (!deliveryIsCurrent(token)) return false;
      window.alert("Link copied.");
      return true;
    }
    if (!deliveryIsCurrent(token)) return false;
    window.prompt("Copy this link:", url);
    return true;
  }

  async function deliverGroup(expectedSignature = currentPlanSignature()) {
    const token = beginDelivery(expectedSignature);
    if (!token) return;
    try {
      const stored = await createSecurePlan(expectedSignature);
      if (!deliveryIsCurrent(token)) return;
      if (!stored) {
        window.NVSShare?.shareGroup?.();
        return;
      }
      await nativeShare({
        title: `Meetup to ${stored.plan.destination.label} — Meet Schwerin`,
        text: `Read-only Meet Schwerin group plan to ${stored.plan.destination.label}. Voluntary check-ins from personal links appear here.`,
        url: stored.url,
      }, token);
    } catch (error) {
      if (error?.name === "AbortError" || !deliveryIsCurrent(token)) return;
      console.warn("Secure group share unavailable", error);
      window.NVSShare?.shareGroup?.();
    } finally {
      if (token.generation === deliveryGeneration) {
        sharing = false;
        activeDeliverySignature = null;
        renderManagement();
      }
    }
  }

  async function deliverPerson(index, expectedSignature = currentPlanSignature()) {
    if (window.NVSShare?.isViewer?.()) return;
    const token = beginDelivery(expectedSignature);
    if (!token) return;
    try {
      const stored = await createSecurePlan(expectedSignature);
      if (!deliveryIsCurrent(token)) return;
      if (!stored) {
        window.NVSShare?.sharePerson?.(index);
        return;
      }
      const key = stored.memberKeys[index];
      const person = stored.plan.members[index];
      if (!key || !person) throw new Error("SECURE_SHARE_MEMBER_MISSING");

      const url = new URL(stored.url);
      url.searchParams.set("me", String(index + 1));
      url.searchParams.set("k", key);
      await nativeShare({
        title: `Your route to ${stored.plan.destination.label} — Meet Schwerin`,
        text: `${person.name}'s read-only Meet Schwerin route. This personal link can voluntarily update only ${person.name}'s meetup status.`,
        url: url.toString(),
      }, token);
    } catch (error) {
      if (error?.name === "AbortError" || !deliveryIsCurrent(token)) return;
      console.warn("Secure personal share unavailable", error);
      window.NVSShare?.sharePerson?.(index);
    } finally {
      if (token.generation === deliveryGeneration) {
        sharing = false;
        activeDeliverySignature = null;
        renderManagement();
      }
    }
  }

  function memberIndexFor(button) {
    const row = button.closest(".group-card-person");
    const primary = button.closest('.result[data-map-pair="primary"]');
    if (!row || !primary) return -1;
    const explicit = Number(row.dataset.shareMemberIndex);
    if (Number.isInteger(explicit) && explicit >= 0) return explicit;
    return [...primary.querySelectorAll(".group-card-person")].indexOf(row);
  }

  document.addEventListener("click", (event) => {
    if (!ownsLifecycle() || window.NVSShare?.isViewer?.()) return;

    const personButton = event.target.closest?.(".person-share-link");
    if (personButton) {
      const index = memberIndexFor(personButton);
      if (index < 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmShare("person", index);
      return;
    }

    const groupButton = event.target.closest?.("#shareMeetupButton");
    if (groupButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmShare("group");
    }
  }, true);

  function handlePlannerMutation() {
    if (!ownsLifecycle()) return;
    const current = currentPlanSignature();
    const pendingChanged = Boolean(pendingShare?.signature && pendingShare.signature !== current);
    const activeChanged = Boolean(sharing && activeDeliverySignature && activeDeliverySignature !== current);
    if (pendingChanged || activeChanged) invalidateDelivery({ dismissDialog: pendingChanged });
    scheduleSync();
  }

  function suspendPlanSync() {
    cancelScheduledSync();
    invalidatePlanSync();
  }

  function suspendOrganizerControls() {
    invalidateSecureCreate();
    invalidateCapabilityRotation();
  }

  window.addEventListener("nvs-group-recommendations-rendered", handlePlannerMutation);
  window.addEventListener("nvs-priority-change", handlePlannerMutation);
  window.addEventListener("nvs-timing-change", handlePlannerMutation);
  window.addEventListener("pagehide", () => {
    lifecycleFrozen = true;
    suspendPlanSync();
    suspendOrganizerControls();
    invalidateDelivery({ dismissDialog: true });
  });
  window.addEventListener("pageshow", () => {
    lifecycleFrozen = false;
    if (!document.hidden) {
      renderManagement();
      scheduleSync();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      suspendPlanSync();
      suspendOrganizerControls();
      invalidateDelivery({ dismissDialog: true });
      return;
    }
    if (!lifecycleFrozen) {
      renderManagement();
      scheduleSync();
    }
  });

  window.NVSShare010 = Object.freeze({
    shareGroup: () => confirmShare("group"),
    sharePerson: (index) => confirmShare("person", Number(index)),
    sync: () => syncExistingPlan(),
    resetPrivateLinks: () => rotateCapabilities(),
    resetPersonLink: (index) => rotateCapabilities(Number(index)),
    getPlanId: () => secureCache?.id || null,
    getExpiresAt: () => cacheExpiresAt(),
    isSessionExpired: () => cacheExpired(),
    isLifecycleFrozen: () => lifecycleFrozen,
  });
})();