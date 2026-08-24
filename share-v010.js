(() => {
  const config = window.NVSConfig || {};
  const destinationInput = document.getElementById("destination");
  const dateInput = document.getElementById("date");
  const timeInput = document.getElementById("time");
  let secureCache = null;
  let sharing = false;

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

  async function createSecurePlan() {
    const plan = payload();
    if (!plan || !config.backendUrl) return null;
    const sig = signature(plan);
    if (secureCache?.signature === sig) return { ...secureCache, plan };

    const response = await fetch(`${String(config.backendUrl).replace(/\/$/, "")}/api/plans`, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json", "x-meet-schwerin": "1" },
      body: JSON.stringify({ plan }),
    });
    if (!response.ok) throw new Error(`SECURE_SHARE_HTTP_${response.status}`);
    const data = await response.json();
    if (!data?.url || !Array.isArray(data.memberKeys) || data.memberKeys.length < plan.members.length) {
      throw new Error("SECURE_SHARE_CAPABILITIES_MISSING");
    }
    secureCache = {
      signature: sig,
      url: data.url,
      memberKeys: data.memberKeys,
      expiresIn: data.expiresIn || 259200,
    };
    return { ...secureCache, plan };
  }

  async function deliver(index) {
    if (sharing || window.NVSShare?.isViewer?.()) return;
    sharing = true;
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
      const shareUrl = url.toString();
      const title = `Your route to ${stored.plan.destination.label} — Meet Schwerin`;
      const text = `${person.name}'s read-only Meet Schwerin route. This personal link can voluntarily update only ${person.name}'s meetup status.`;

      if (navigator.share) {
        await navigator.share({ title, text, url: shareUrl });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        window.alert(`${person.name}'s personal link was copied.`);
      } else {
        window.prompt("Copy this personal route link:", shareUrl);
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Secure personal share unavailable", error);
      window.NVSShare?.sharePerson?.(index);
    } finally {
      sharing = false;
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

  // Capture before the v0.7.2 button handler so personal links can receive their
  // v0.10 capability without changing the legacy group-share implementation.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".person-share-link");
    if (!button || window.NVSShare?.isViewer?.()) return;
    const index = memberIndexFor(button);
    if (index < 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    deliver(index);
  }, true);

  ["nvs-group-change", "nvs-priority-change", "nvs-timing-change"].forEach((name) => {
    window.addEventListener(name, () => { secureCache = null; });
  });

  window.NVSShare010 = Object.freeze({ sharePerson: deliver });
})();
