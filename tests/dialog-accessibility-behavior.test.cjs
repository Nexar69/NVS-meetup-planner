const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.attrs = new Map();
    this.listeners = new Map();
    this.children = new Map();
    this.open = false;
    this.isConnected = true;
    this.focusCount = 0;
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) || null; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  dispatch(name, event = {}) { this.listeners.get(name)?.({ target: this, ...event }); }
  querySelector(selector) { return this.children.get(selector) || null; }
  querySelectorAll() { return []; }
  focus() { this.focusCount += 1; document.activeElement = this; }
  closest(selector) {
    return selector.split(",").some((part) => part.trim() === `#${this.id}`) ? this : null;
  }
}

const elements = new Map();
const add = (element) => { elements.set(element.id, element); return element; };

const tripOpener = add(new FakeElement("v011TripModeButton"));
const alertOpener = add(new FakeElement("v011AlertSettingsButton"));
const tripSettings = add(new FakeElement("v011TripSettings"));
const tripLabel = add(new FakeElement("v011TripPerson"));
const tripDescription = add(new FakeElement("v011TripDetail"));
const settingsLabel = add(new FakeElement("v011SettingsTitle"));
const settingsDescription = add(new FakeElement("v011SettingsDescription"));
const tripDialog = add(new FakeElement("v011TripDialog"));
const settingsDialog = add(new FakeElement("v011SettingsDialog"));
const tripClose = new FakeElement("tripClose");
const settingsClose = new FakeElement("settingsClose");
tripDialog.children.set(".v011-trip-close", tripClose);
settingsDialog.children.set(".v011-settings-close", settingsClose);

const documentListeners = new Map();
global.document = {
  activeElement: null,
  documentElement: {},
  getElementById: (id) => elements.get(id) || null,
  addEventListener: (name, fn) => documentListeners.set(name, fn),
};
const windowListeners = new Map();
global.window = {
  addEventListener: (name, fn) => windowListeners.set(name, fn),
};
global.MutationObserver = class { observe() {} };
global.requestAnimationFrame = (fn) => { fn(); return 1; };
global.queueMicrotask = (fn) => fn();

const source = fs.readFileSync(path.resolve(__dirname, "../accessibility-v0111.js"), "utf8");
vm.runInThisContext(source, { filename: "accessibility-v0111.js" });

assert.equal(tripDialog.getAttribute("role"), "dialog");
assert.equal(tripDialog.getAttribute("aria-modal"), "true");
assert.equal(tripDialog.getAttribute("aria-labelledby"), tripLabel.id);
assert.equal(tripDialog.getAttribute("aria-describedby"), tripDescription.id);
assert.equal(settingsDialog.getAttribute("role"), "dialog");
assert.equal(settingsDialog.getAttribute("aria-modal"), "true");
assert.equal(settingsDialog.getAttribute("aria-labelledby"), settingsLabel.id);
assert.equal(settingsDialog.getAttribute("aria-describedby"), settingsDescription.id);

const click = documentListeners.get("click");
assert.equal(typeof click, "function", "accessibility runtime should observe opener clicks");

tripDialog.open = true;
click({ target: tripOpener });
assert.equal(document.activeElement, tripClose, "Trip Mode should focus its close control after opening");
tripDialog.dispatch("close");
assert.equal(document.activeElement, tripOpener, "Trip Mode should restore focus to its launcher");

settingsDialog.open = true;
click({ target: alertOpener });
assert.equal(document.activeElement, settingsClose, "Alert settings should focus its close control after opening");
settingsDialog.dispatch("close");
assert.equal(document.activeElement, alertOpener, "Alert settings should restore focus to the command-center opener");

click({ target: tripSettings });
assert.equal(document.activeElement, settingsClose, "nested Alert settings should focus its own close control");
settingsDialog.dispatch("close");
assert.equal(document.activeElement, tripSettings, "nested Alert settings should restore focus inside Trip Mode");

console.log("dialog-accessibility-behavior: dialog labels and focus lifecycle passed");
