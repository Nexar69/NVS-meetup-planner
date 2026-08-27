(() => {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("test") === "1" || params.get("test") === "true";
  if (!enabled || window.NVSTestLab?.active) return;

  const NativeDate = window.Date;
  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const realNow = () => NativeDate.now();

  let anchorReal = realNow();
  let anchorVirtual = anchorReal;
  let speed = 1;
  let paused = false;
  let renderTimer = null;

  function virtualNow() {
    if (paused) return anchorVirtual;
    return anchorVirtual + Math.max(0, realNow() - anchorReal) * speed;
  }

  function reanchor(nextVirtual = virtualNow()) {
    anchorVirtual = Number(nextVirtual);
    anchorReal = realNow();
  }

  function emitChange(reason) {
    window.dispatchEvent(new CustomEvent("nvs-test-clock-change", {
      detail: { reason, now: virtualNow(), speed, paused },
    }));
  }

  class TestDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(virtualNow());
      else super(...args);
    }

    static now() {
      return virtualNow();
    }
  }

  Object.setPrototypeOf(TestDate, NativeDate);
  window.Date = TestDate;

  function setNow(value) {
    const parsed = value instanceof NativeDate ? value.getTime() : Number(value);
    if (!Number.isFinite(parsed)) return false;
    reanchor(parsed);
    emitChange("set");
    render();
    return true;
  }

  function advance(minutes) {
    const amount = Number(minutes);
    if (!Number.isFinite(amount)) return false;
    reanchor(virtualNow() + amount * 60_000);
    emitChange("advance");
    render();
    return true;
  }

  function setSpeed(value) {
    const next = Number(value);
    if (![1, 5, 30, 60].includes(next)) return false;
    reanchor();
    speed = next;
    emitChange("speed");
    render();
    return true;
  }

  function setPaused(value) {
    const next = Boolean(value);
    if (paused === next) return;
    reanchor();
    paused = next;
    emitChange(next ? "pause" : "resume");
    render();
  }

  function reset() {
    anchorReal = realNow();
    anchorVirtual = anchorReal;
    speed = 1;
    paused = false;
    emitChange("reset");
    render();
  }

  function backendOrigin() {
    const raw = window.__NVS_BACKEND_URL__ || window.NVSConfig?.backendUrl || window.location.origin;
    try { return new URL(raw, window.location.href).origin; } catch { return window.location.origin; }
  }

  function isProtectedWrite(input, init = {}) {
    const method = String(init.method || input?.method || "GET").toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false;
    let url;
    try { url = new URL(typeof input === "string" ? input : input?.url, window.location.href); } catch { return false; }
    const sameBackend = url.origin === backendOrigin();
    return sameBackend && url.pathname.startsWith("/api/");
  }

  if (nativeFetch) {
    window.fetch = async function testLabFetch(input, init) {
      if (!isProtectedWrite(input, init)) return nativeFetch(input, init);
      const detail = { method: String(init?.method || input?.method || "POST").toUpperCase() };
      window.dispatchEvent(new CustomEvent("nvs-test-write-blocked", { detail }));
      return new Response(JSON.stringify({
        error: "TEST_MODE_WRITE_BLOCKED",
        message: "Test Mode blocks shared/backend writes by default.",
      }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    };
  }

  function formatLocalInput(ms) {
    const date = new NativeDate(ms);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseLocalInput(value) {
    if (!value) return NaN;
    const parsed = new NativeDate(value);
    return parsed.getTime();
  }

  function formatClock(ms) {
    return new Intl.DateTimeFormat("de-DE", {
      weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).format(new NativeDate(ms));
  }

  function ensurePanel() {
    let root = document.getElementById("nvsTestLab");
    if (root) return root;

    root = document.createElement("aside");
    root.id = "nvsTestLab";
    root.className = "nvs-test-lab";
    root.setAttribute("aria-label", "Meet Schwerin Test Lab");
    root.innerHTML = `
      <div class="nvs-test-banner" role="status">🧪 TEST MODE · writes blocked</div>
      <details open>
        <summary>Test Lab</summary>
        <div class="nvs-test-body">
          <div class="nvs-test-readout"><strong id="nvsTestVirtual"></strong><small id="nvsTestReal"></small></div>
          <label class="nvs-test-field">Simulated date & time<input id="nvsTestDateTime" type="datetime-local"></label>
          <div class="nvs-test-actions" aria-label="Move simulated time">
            <button type="button" data-jump="-15">−15m</button><button type="button" data-jump="-5">−5m</button><button type="button" data-jump="-1">−1m</button>
            <button type="button" data-jump="1">+1m</button><button type="button" data-jump="5">+5m</button><button type="button" data-jump="15">+15m</button>
          </div>
          <div class="nvs-test-row">
            <label class="nvs-test-field">Clock speed<select id="nvsTestSpeed"><option value="1">1×</option><option value="5">5×</option><option value="30">30×</option><option value="60">60×</option></select></label>
            <button type="button" id="nvsTestPause">Pause</button>
          </div>
          <button type="button" id="nvsTestRealTime" class="nvs-test-reset">Return to real time</button>
          <p class="nvs-test-note">Virtual time affects this tab only. Backend/API writes are blocked so simulated actions cannot alter the real shared meetup.</p>
        </div>
      </details>`;
    document.body.appendChild(root);

    root.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => advance(Number(button.dataset.jump)));
    });
    root.querySelector("#nvsTestDateTime")?.addEventListener("change", (event) => setNow(parseLocalInput(event.target.value)));
    root.querySelector("#nvsTestSpeed")?.addEventListener("change", (event) => setSpeed(event.target.value));
    root.querySelector("#nvsTestPause")?.addEventListener("click", () => setPaused(!paused));
    root.querySelector("#nvsTestRealTime")?.addEventListener("click", reset);
    return root;
  }

  function render() {
    if (!document.body) return;
    const root = ensurePanel();
    const now = virtualNow();
    const virtual = root.querySelector("#nvsTestVirtual");
    const real = root.querySelector("#nvsTestReal");
    const input = root.querySelector("#nvsTestDateTime");
    const speedSelect = root.querySelector("#nvsTestSpeed");
    const pauseButton = root.querySelector("#nvsTestPause");
    if (virtual) virtual.textContent = `Simulated ${formatClock(now)}`;
    if (real) real.textContent = `Real ${formatClock(realNow())}`;
    if (input && document.activeElement !== input) input.value = formatLocalInput(now);
    if (speedSelect) speedSelect.value = String(speed);
    if (pauseButton) pauseButton.textContent = paused ? "Resume" : "Pause";
  }

  function scheduleRender() {
    if (renderTimer) clearTimeout(renderTimer);
    if (document.hidden) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      render();
      scheduleRender();
    }, 1_000);
  }

  window.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = null;
    } else {
      render();
      scheduleRender();
    }
  });

  window.NVSTestLab = Object.freeze({
    active: true,
    now: virtualNow,
    realNow,
    setNow,
    advance,
    setSpeed,
    setPaused,
    reset,
    isPaused: () => paused,
    getSpeed: () => speed,
    writesBlocked: true,
  });

  document.documentElement.dataset.nvsTestMode = "true";
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { render(); scheduleRender(); }, { once: true });
  else { render(); scheduleRender(); }
})();
