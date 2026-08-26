const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../update-safety-v0111.js"), "utf8");
const loader = fs.readFileSync(path.resolve(__dirname, "../v05.js"), "utf8");
const sw = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

const listeners = {};
const windowListeners = {};
let tripOpen = false;
let nextTimerId = 1;
const timers = new Map();
let fakeNow = Date.UTC(2026, 7, 26, 12, 0, 0);

const strong = { textContent: "Meet Schwerin update ready" };
const small = { textContent: "A newer app shell has finished downloading." };
const button = {
  textContent: "Reload update",
  matches(selector) { return selector === "#v011UpdateBanner button"; },
  closest(selector) { return selector === "#v011UpdateBanner" ? banner : null; },
};
const banner = {
  hidden: false,
  attrs: {},
  querySelector(selector) {
    if (selector === "strong") return strong;
    if (selector === "small") return small;
    if (selector === "button") return button;
    return null;
  },
  setAttribute(name, value) { this.attrs[name] = value; },
  removeAttribute(name) { delete this.attrs[name]; },
};

const document = {
  hidden: false,
  getElementById(id) {
    if (id === "v011TripDialog") return { open: tripOpen };
    if (id === "v011UpdateBanner") return banner;
    return null;
  },
  addEventListener(name, handler, options) { listeners[name] = { handler, options }; },
};
const window = {
  __NVS_LAST_RECOMMENDATIONS__: null,
  NVSShare: { getFocusIndex: () => 0 },
  addEventListener(name, handler) { windowListeners[name] = handler; },
};

class FakeDate extends Date {
  static now() { return fakeNow; }
}

function setTimeoutFake(fn, delay) {
  const id = nextTimerId++;
  timers.set(id, { fn, delay });
  return id;
}
function clearTimeoutFake(id) { timers.delete(id); }

vm.runInNewContext(source, {
  window,
  document,
  Date: FakeDate,
  Number,
  Array,
  Math,
  Object,
  setTimeout: setTimeoutFake,
  clearTimeout: clearTimeoutFake,
});

const api = window.NVSUpdateSafety0111;
assert.ok(api, "update safety API should be exposed for deterministic testing");
assert.equal(listeners.click?.options, true, "update guard should intercept the click in capture phase before the base reload handler");

const now = fakeNow;
const at = (minutes) => new Date(now + minutes * 60_000);
window.__NVS_LAST_RECOMMENDATIONS__ = {
  primary: {
    assignments: [{
      route: {
        segments: [
          { departure: at(-5), arrival: at(10) },
          { departure: at(12), arrival: at(25) },
        ],
      },
    }],
  },
};

assert.equal(api.isJourneyActive(now), true, "a journey between its first departure and final arrival should be protected");
assert.equal(api.isJourneyActive(now - 14 * 60_000), true, "the update guard should protect the pre-departure preparation window");
assert.equal(api.isJourneyActive(now + 31 * 60_000), false, "the guard should release after the final-arrival grace window");

// Shared plans are serialized through the backend, so ISO date strings must retain protection.
window.__NVS_LAST_RECOMMENDATIONS__ = {
  primary: {
    assignments: [{ route: { segments: [{ departure: at(-5).toISOString(), arrival: at(25).toISOString() }] } }],
  },
};
assert.equal(api.isJourneyActive(now), true, "serialized ISO route times must keep active-trip update protection working");
assert.deepEqual(
  Object.values(api.routeWindow(window.__NVS_LAST_RECOMMENDATIONS__.primary.assignments[0].route)),
  [at(-5).getTime(), at(25).getTime()],
  "route windows should normalize serialized timestamps",
);
assert.equal(api.routeWindow({ segments: [{ departure: "bad", arrival: "also-bad" }] }), null, "invalid serialized times should fail closed without inventing an active trip");
assert.equal(api.routeWindow({ segments: [{ departure: at(10), arrival: at(5) }] }), null, "backwards route windows should be rejected");

window.__NVS_LAST_RECOMMENDATIONS__ = {
  primary: { assignments: [{ route: { segments: [{ departure: at(-5), arrival: at(25) }] } }] },
};

let prevented = 0;
let stopped = 0;
let immediate = 0;
const firstEvent = {
  target: button,
  preventDefault() { prevented += 1; },
  stopPropagation() { stopped += 1; },
  stopImmediatePropagation() { immediate += 1; },
};
assert.equal(api.handleUpdateClick(firstEvent, now), true, "the first active-trip update tap should be deferred");
assert.equal(prevented, 1);
assert.equal(stopped, 1);
assert.equal(immediate, 1);
assert.equal(strong.textContent, "Trip active — update deferred");
assert.match(small.textContent, /Tap again within 8 seconds/);
assert.equal(button.textContent, "Update now anyway");
assert.equal(banner.attrs["data-update-deferred"], "true");
assert.equal(timers.size, 1, "visible pages should arm one confirmation reset timer");

const secondEvent = {
  target: button,
  preventDefault() { throw new Error("second explicit tap must not be prevented"); },
  stopPropagation() { throw new Error("second explicit tap must be allowed to reach the base handler"); },
  stopImmediatePropagation() { throw new Error("second explicit tap must be allowed to reach the base handler"); },
};
assert.equal(api.handleUpdateClick(secondEvent, now + 1_000), false, "a second explicit tap in the confirmation window should allow the update");
assert.equal(strong.textContent, "Meet Schwerin update ready");
assert.equal(button.textContent, "Reload update");
assert.equal(timers.size, 0, "allowing the explicit second tap should cancel the deferred reset timer");

// Reproduce Safari backgrounding during the 8-second confirmation window.
assert.equal(api.handleUpdateClick(firstEvent, now), true);
document.hidden = true;
listeners.visibilitychange.handler();
assert.equal(timers.size, 0, "backgrounding should suspend the confirmation reset timer");
fakeNow = now + 3_000;
document.hidden = false;
listeners.visibilitychange.handler();
assert.equal(timers.size, 1, "returning before expiry must re-arm the remaining confirmation window");
const resumedTimer = [...timers.values()][0];
assert.equal(resumedTimer.delay, 5_000, "Safari resume should schedule only the remaining confirmation time");
resumedTimer.fn();
assert.equal(strong.textContent, "Meet Schwerin update ready");
assert.equal(button.textContent, "Reload update");

// Returning after the window has elapsed should reset immediately, not leave a stuck deferred banner.
fakeNow = now;
assert.equal(api.handleUpdateClick(firstEvent, now), true);
document.hidden = true;
listeners.visibilitychange.handler();
fakeNow = now + 9_000;
document.hidden = false;
listeners.visibilitychange.handler();
assert.equal(strong.textContent, "Meet Schwerin update ready");
assert.equal(button.textContent, "Reload update");
assert.equal(timers.size, 0);

window.__NVS_LAST_RECOMMENDATIONS__ = {
  primary: { assignments: [{ route: { segments: [{ departure: at(40), arrival: at(60) }] } }] },
};
const ordinaryEvent = {
  target: button,
  preventDefault() { throw new Error("ordinary update tap must not be blocked"); },
};
assert.equal(api.handleUpdateClick(ordinaryEvent, now), false, "updates outside the protected journey window should behave normally");

tripOpen = true;
window.__NVS_LAST_RECOMMENDATIONS__ = null;
assert.equal(api.isJourneyActive(now), true, "an explicitly open Trip Mode should always protect against accidental reload");
tripOpen = false;

assert.match(loader, /update-safety-v0111\.js/, "the normal app loader must load update safety");
assert.match(sw, /update-safety-v0111\.js/, "the PWA app shell must include update safety for offline/home-screen use");
assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/i, "update safety must not add location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest/i, "update safety must not persist data or add network traffic");

console.log("update-safety: serialized routes, active-trip deferral, Safari visibility resume, explicit override, PWA wiring and privacy boundaries passed");
