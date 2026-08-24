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
      timing: recommendations.timingMode || window.NVSRecommend?.getTimingMode?.() || "target",
      date: dateInput?.value || "",
      time: timeInput?.value || "",
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

  function identitySignature(plan) {
    return JSON.stringify((plan?.members || []).map((member) => String(member?.name || "")));
  }

  function renderManagement() {
    const element = document.getElementById("v010ShareDialog");
    if (!element) return;
    const button = element.querySelector(".v010-share-revoke");
    const note = element.querySelector("#v010ShareSecurityNote");
    if (button) {
      button.hidden = !secureCache;
      button.disabled = rotating || sharing;
      button.textContent = rotating ? "Resetting…" : "Reset private links";
    }
    if (note) {
      note.hidden = !secureCache;
      note.textContent = secureCache
        ? "Organizer control: resetting private links makes every previously issued personal check-in link read-only. Existing visible check-in history is kept."
        : "";
    }
  }

  async function syncExistingPlan(nextPlan) {
    if (!secureCache?.id || !secureCache?.ownerKey || !config.backendUrl) return false;
    const plan = nextPlan || payload();
    if (!plan) return false;

    const identity = identitySignature(plan);
    if (identity !== secureCache.identity) {
      secureCache = null;
      renderManagement();
      return false;
    }

    const sig = signature(plan);
    if (sig === secureCache.signature) return true;

    const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/live/${secureCache.id}/plan`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
      body: JSON.stringify({ key: secureCache.ownerKey, plan }),
    });
    if (response.status === 409) {
      secureCache = null;
      renderManagement();
      return false;
    }
    if (!response.ok) throw new Error(`LIVE_PLAN_SYNC_HTTP_${response.status}`);
    const data = await response.json();
    secureCache.signature = sig;
    secureCache.revision = Number(data?.revision) || secureCache.revision || 1;
    window.dispatchEvent(new CustomEvent("nvs-live-plan-synced", {
      detail: { id: secureCache.id, revision: secureCache.revision },
    }));
    return true;
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    if (!secureCache) return;
    syncTimer = setTimeout(() => {
      syncExistingPlan().catch((error) => console.warn("Shared live plan sync failed", error));
    }, 700);
  }

  async function createSecurePlan() {
    const plan = payload();
    if (!plan || !config.backendUrl) return null;
    const sig = signature(plan);
    const identity = identitySignature(plan);

    if (secureCache) {
      if (secureCache.identity !== identity) {
        secureCache = null;
        renderManagement();
      } else {
        if (secureCache.signature !== sig) await syncExistingPlan(plan);
        if (secureCache?.signature === sig) return { ...secureCache, plan };
      }
    }

    const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/plans`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) throw new Error(`SECURE_SHARE_HTTP_${response.status}`);
    const data = await response.json();
    if (!data?.id || !data?.url || !data?.ownerKey || !Array.isArray(data.memberKeys) || data.memberKeys.length < plan.members.length) {
      throw new Error("SECURE_SHARE_CAPABILITIES_MISSING");
    }
    secureCache = {
      id: data.id,
      identity,
      signature: sig,
      url: data.url,
      ownerKey: data.ownerKey,
      memberKeys: data.memberKeys,
      revision: Number(data.revision) || 1,
      expiresIn: data.expiresIn || 259200,
    };
    renderManagement();
    return { ...secureCache, plan };
  }

  async function rotateCapabilities(member = null) {
    if (!secureCache?.id || !secureCache?.ownerKey || !config.backendUrl || rotating) return false;
    rotating = true;
    renderManagement();
    try {
      const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/live/${secureCache.id}/capabilities`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
        body: JSON.stringify({ key: secureCache.ownerKey, ...(Number.isInteger(member) ? { member } : {}) }),
      });
      if (!response.ok) throw new Error(`CAPABILITY_ROTATE_HTTP_${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data?.memberKeys) || data.memberKeys.length !== secureCache.memberKeys.length) {
        throw new Error("CAPABILITY_ROTATE_BAD_RESPONSE");
      }
      secureCache.memberKeys = data.memberKeys;
      window.dispatchEvent(new CustomEvent("nvs-share-capabilities-rotated", {
        detail: { id: secureCache.id, member: Number.isInteger(member) ? member : null },
      }));
      return true;
    } finally {
      rotating = false;
      renderManagement();
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
        <button type="button" class="secondary-button v010-share-revoke" hidden>Reset private links</button>
        <button type="button" class="secondary-button v010-share-cancel">Cancel</button>
        <button type="button" class="search-button v010-share-confirm"><span>Share link</span><span aria-hidden="true">↗</span></button>
      </div>`;
    document.body.appendChild(element);
    element.querySelector(".group-share-close")?.addEventListener("click", () => element.close());
    element.querySelector(".v010-share-cancel")?.addEventListener("click", () => element.close());
    element.addEventListener("click", (event) => { if (event.target === element) element.close(); });
    element.querySelector(".v010-share-confirm")?.addEventListener("click", async () => {
      const action = pendingShare;
      pendingShare = null;
      element.close();
      if (action?.type === "group") await deliverGroup();
      if (action?.type === "person") await deliverPerson(action.index);
    });
    element.querySelector(".v010-share-revoke")?.addEventListener("click", async () => {
      if (!secureCache || rotating) return;
      const confirmed = window.confirm("Reset every private personal check-in link for this meetup? Old personal links will stay readable but can no longer post status updates. Existing visible check-ins will remain.");
      if (!confirmed) return;
      try {
        const changed = await rotateCapabilities();
        if (changed) window.alert("Private check-in links reset. Share fresh personal links with anyone who should still be able to check in.");
      } catch (error) {
        console.warn("Private link reset failed", error);
        window.alert("Could not reset private links. Check your connection and try again.");
      }
    });
    renderManagement();
    return element;
  }

  function confirmShare(type, index = -1) {
    if (window.NVSShare?.isViewer?.()) return;
    const plan = payload();
    if (!plan) {
      window.alert("Find a live group recommendation before sharing it.");
      return;
    }
    const element = dialog();
    const person = type === "person" ? plan.members[index] : null;
    pendingShare = { type, index };
    element.querySelector("#v010ShareTitle").textContent = person ? `Share ${person.name}'s live route` : "Share whole live meetup";
    element.querySelector("#v010ShareCopy").innerHTML = person
      ? `<p>This creates a <strong>read-only personal route</strong> for ${escapeHtml(person.name)} with a private check-in capability for that person only.</p><p class="group-share-warning">The link contains a random write key. Anyone you forward this exact personal link to can update ${escapeHtml(person.name)}'s voluntary meetup status until the plan expires or you reset the private links.</p>`
      : `<p>This creates the <strong>read-only whole-group view</strong>. It can see voluntary check-ins but cannot post as any person.</p><p class="group-share-warning">The shared plan contains group names, starting locations, meetup place/time and route preferences. It expires automatically after about 72 hours.</p>`;
    renderManagement();
    element.showModal();
  }

  async function nativeShare({ title, text, url }) {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      window.alert("Link copied.");
      return;
    }
    window.prompt("Copy this link:", url);
  }

  async function deliverGroup() {
    if (sharing) return;
    sharing = true;
    renderManagement();
    try {
      const stored = await createSecurePlan();
      if (!stored) {
        window.NVSShare?.shareGroup?.();
        return;
      }
      await nativeShare({
        title: `Meetup to ${stored.plan.destination.label} — Meet Schwerin`,
        text: `Read-only Meet Schwerin group plan to ${stored.plan.destination.label}. Voluntary check-ins from personal links appear here.`,
        url: stored.url,
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Secure group share unavailable", error);
      window.NVSShare?.shareGroup?.();
    } finally {
      sharing = false;
      renderManagement();
    }
  }

  async function deliverPerson(index) {
    if (sharing || window.NVSShare?.isViewer?.()) return;
    sharing = true;
    renderManagement();
    try {
      const stored = await createSecurePlan();
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
      });
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Secure personal share unavailable", error);
      window.NVSShare?.sharePerson?.(index);
    } finally {
      sharing = false;
      renderManagement();
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
    if (window.NVSShare?.isViewer?.()) return;

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

  window.addEventListener("nvs-group-recommendations-rendered", scheduleSync);
  window.addEventListener("nvs-priority-change", scheduleSync);
  window.addEventListener("nvs-timing-change", scheduleSync);

  window.NVSShare010 = Object.freeze({
    shareGroup: () => confirmShare("group"),
    sharePerson: (index) => confirmShare("person", Number(index)),
    sync: () => syncExistingPlan(),
    resetPrivateLinks: () => rotateCapabilities(),
    resetPersonLink: (index) => rotateCapabilities(Number(index)),
    getPlanId: () => secureCache?.id || null,
  });
})();
