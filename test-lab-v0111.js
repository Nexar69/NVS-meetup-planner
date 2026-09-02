(() => {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("test") === "1" || params.get("test") === "true";
  if (!enabled || window.NVSTestLab?.active) return;

  const NativeDate = window.Date;
  const nativeFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;
  const realNow = () => NativeDate.now();
  const NETWORK_MODES = Object.freeze(["normal", "slow-2", "slow-5", "vmv-fail", "transit-fail", "all-fail", "offline-api"]);

  let anchorReal = realNow();
  let anchorVirtual = anchorReal;
  let speed = 1;
  let paused = false;
  let networkMode = "normal";
  let renderTimer = null;
  let lastFetch = { label: "None yet", status: "—", ms: null, at: null };

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

  function emitState(reason) {
    window.dispatchEvent(new CustomEvent("nvs-test-state-change", {
      detail: { reason, enabled: true, now: virtualNow(), speed, paused, network: networkMode },
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
  try {
    Object.defineProperty(TestDate, Symbol.hasInstance, {
      configurable: true,
      value(instance) { return instance instanceof NativeDate; },
    });
  } catch {}
  window.Date = TestDate;

  function setNow(value) {
    const parsed = value instanceof NativeDate ? value.getTime() : Number(value);
    if (!Number.isFinite(parsed)) return false;
    reanchor(parsed);
    emitChange("set");
    emitState("clock-set");
    render();
    return true;
  }

  function advance(minutes) {
    const amount = Number(minutes);
    if (!Number.isFinite(amount)) return false;
    reanchor(virtualNow() + amount * 60_000);
    emitChange("advance");
    emitState("clock-advance");
    render();
    return true;
  }

  function setSpeed(value) {
    const next = Number(value);
    if (![1, 5, 30, 60].includes(next)) return false;
    reanchor();
    speed = next;
    emitChange("speed");
    emitState("clock-speed");
    render();
    return true;
  }

  function setPaused(value) {
    const next = Boolean(value);
    if (paused === next) return;
    reanchor();
    paused = next;
    emitChange(next ? "pause" : "resume");
    emitState(next ? "clock-pause" : "clock-resume");
    render();
  }

  function reset() {
    anchorReal = realNow();
    anchorVirtual = anchorReal;
    speed = 1;
    paused = false;
    networkMode = "normal";
    lastFetch = { label: "None yet", status: "—", ms: null, at: null };
    emitChange("reset");
    emitState("reset");
    render();
  }

  function setNetwork(value) {
    const next = String(value || "normal");
    if (!NETWORK_MODES.includes(next)) return false;
    networkMode = next;
    emitState("network");
    render();
    return true;
  }

  function backendOrigin() {
    const raw = window.__NVS_BACKEND_URL__ || window.NVSConfig?.backendUrl || window.location.origin;
    try { return new URL(raw, window.location.href).origin; } catch { return window.location.origin; }
  }

  function requestInfo(input, init = {}) {
    const method = String(init.method || input?.method || "GET").toUpperCase();
    let url = null;
    try { url = new URL(typeof input === "string" ? input : input?.url, window.location.href); } catch {}
    return { method, url };
  }

  function isProtectedWrite(input, init = {}) {
    const { method, url } = requestInfo(input, init);
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method) || !url) return false;
    return url.origin === backendOrigin() && url.pathname.startsWith("/api/");
  }

  function classifyRequest(url) {
    if (!url) return "Other";
    if (url.origin === backendOrigin() && url.pathname === "/api/vmv/plan") return "VMV";
    if (url.hostname === "api.transitous.org" && url.pathname.startsWith("/api/v6/plan")) return "Transitous";
    if (url.origin === backendOrigin() && url.pathname.startsWith("/api/live/")) return "Shared Live";
    if (url.origin === backendOrigin() && url.pathname.startsWith("/api/")) return "Backend API";
    return "Other";
  }

  function shouldFail(label, url) {
    if (networkMode === "normal" || networkMode.startsWith("slow-")) return false;
    if (networkMode === "vmv-fail") return label === "VMV";
    if (networkMode === "transit-fail") return label === "Transitous";
    if (networkMode === "all-fail") return label === "VMV" || label === "Transitous";
    if (networkMode === "offline-api") {
      return Boolean(url && (url.origin === backendOrigin() || url.hostname === "api.transitous.org"));
    }
    return false;
  }

  function delayMs() {
    if (networkMode === "slow-2") return 2_000;
    if (networkMode === "slow-5") return 5_000;
    return 0;
  }

  function sleep(ms) {
    return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
  }

  function recordFetch(label, status, started) {
    lastFetch = {
      label,
      status: String(status),
      ms: Math.max(0, Math.round((typeof performance !== "undefined" ? performance.now() : realNow()) - started)),
      at: realNow(),
    };
    render();
  }

  if (nativeFetch) {
    window.fetch = async function testLabFetch(input, init) {
      const { method, url } = requestInfo(input, init);
      const label = classifyRequest(url);
      const started = typeof performance !== "undefined" ? performance.now() : realNow();

      if (isProtectedWrite(input, init)) {
        const detail = { method };
        window.dispatchEvent(new CustomEvent("nvs-test-write-blocked", { detail }));
        recordFetch(label, "WRITE BLOCKED", started);
        return new Response(JSON.stringify({
          error: "TEST_MODE_WRITE_BLOCKED",
          message: "Test Mode blocks shared/backend writes by default.",
        }), {
          status: 409,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        });
      }

      if (shouldFail(label, url)) {
        recordFetch(label, "SIMULATED FAILURE", started);
        window.dispatchEvent(new CustomEvent("nvs-test-network-failure", { detail: { provider: label } }));
        throw new TypeError(`TEST_MODE_${networkMode.toUpperCase().replaceAll("-", "_")}`);
      }

      await sleep(delayMs());
      try {
        const response = await nativeFetch(input, init);
        recordFetch(label, response.status, started);
        return response;
      } catch (error) {
        recordFetch(label, "ERROR", started);
        throw error;
      }
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

  function diagnosticsText() {
    const age = Number.isFinite(lastFetch.at) ? Math.max(0, Math.round((realNow() - lastFetch.at) / 1000)) : null;
    const latency = Number.isFinite(lastFetch.ms) ? `${lastFetch.ms} ms` : "—";
    return `${networkMode} · ${lastFetch.label} · ${lastFetch.status} · ${latency}${age == null ? "" : ` · ${age}s ago`}`;
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
          <label class="nvs-test-field">Network scenario
            <select id="nvsTestNetwork">
              <option value="normal">Normal</option><option value="slow-2">Slow +2s</option><option value="slow-5">Slow +5s</option>
              <option value="vmv-fail">VMV fails</option><option value="transit-fail">Transitous fails</option>
              <option value="all-fail">Both route providers fail</option><option value="offline-api">Backend + transit APIs offline</option>
            </select>
          </label>
          <div class="nvs-test-diagnostics" aria-live="polite"><strong>Transport</strong><span id="nvsTestDiagnostics"></span></div>
          <button type="button" id="nvsTestRealTime" class="nvs-test-reset">Reset Test Lab</button>
          <p class="nvs-test-note">Virtual time and network faults affect this tab only. Backend/API writes are blocked, and no Test Lab state is saved after the page closes.</p>
        </div>
      </details>`;
    document.body.appendChild(root);

    root.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => advance(Number(button.dataset.jump)));
    });
    root.querySelector("#nvsTestDateTime")?.addEventListener("change", (event) => setNow(parseLocalInput(event.target.value)));
    root.querySelector("#nvsTestSpeed")?.addEventListener("change", (event) => setSpeed(event.target.value));
    root.querySelector("#nvsTestNetwork")?.addEventListener("change", (event) => setNetwork(event.target.value));
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
    const networkSelect = root.querySelector("#nvsTestNetwork");
    const pauseButton = root.querySelector("#nvsTestPause");
    const diagnostics = root.querySelector("#nvsTestDiagnostics");
    if (virtual) virtual.textContent = `Simulated ${formatClock(now)}`;
    if (real) real.textContent = `Real ${formatClock(realNow())}`;
    if (input && document.activeElement !== input) input.value = formatLocalInput(now);
    if (speedSelect) speedSelect.value = String(speed);
    if (networkSelect) networkSelect.value = networkMode;
    if (pauseButton) pauseButton.textContent = paused ? "Resume" : "Pause";
    if (diagnostics) diagnostics.textContent = diagnosticsText();
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

  function suspendRender() {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = null;
  }

  function resumeRender() {
    if (document.hidden) return;
    render();
    scheduleRender();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendRender();
    else resumeRender();
  });
  window.addEventListener("pageshow", resumeRender);
  window.addEventListener("nvs-shared-view-resumed", resumeRender);

  window.NVSTestLab = Object.freeze({
    active: true,
    now: virtualNow,
    realNow,
    setNow,
    advance,
    setSpeed,
    setPaused,
    reset,
    setNetwork,
    getNetwork: () => networkMode,
    getDiagnostics: () => ({ ...lastFetch, network: networkMode }),
    isPaused: () => paused,
    getSpeed: () => speed,
    writesBlocked: true,
    persistent: false,
  });

  document.documentElement.dataset.nvsTestMode = "true";
  emitState("activate");
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { render(); scheduleRender(); }, { once: true });
  else { render(); scheduleRender(); }
})();
