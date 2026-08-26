const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const runtime = read("accessibility-v0111.js");
const styles = read("accessibility-v0111.css");
const release = read("release-v011.js");
const serviceWorker = read("service-worker.js");

assert.match(release, /loadAccessibility0111/, "v0.11.1 release owner should load the accessibility layer");
assert.match(release, /accessibility-v0111\.js/, "accessibility runtime should be wired by the release owner");
assert.match(release, /accessibility-v0111\.css/, "accessibility styles should be wired by the release owner");
assert.match(serviceWorker, /accessibility-v0111\.js/, "accessibility runtime should be available offline");
assert.match(serviceWorker, /accessibility-v0111\.css/, "accessibility styles should be available offline");

assert.match(runtime, /aria-modal/, "dialogs should identify themselves as modal to assistive technology");
assert.match(runtime, /aria-labelledby/, "dialogs should expose an accessible name when possible");
assert.match(runtime, /aria-describedby/, "Trip Mode should expose its changing journey detail as a description");
assert.match(runtime, /queueMicrotask\(\(\) => focusSafely\(opener\)\)/, "closing a dialog should return keyboard focus to its opener");
assert.match(runtime, /requestAnimationFrame/, "opened dialogs should move focus after native showModal completes");
assert.match(runtime, /v010Sync/, "shared-live sync changes should be surfaced as a live region");
assert.match(runtime, /v010Alert/, "shared-live disruption changes should be surfaced as a live region");
assert.match(runtime, /aria-live/, "dynamic status regions should announce non-disruptively");
assert.match(runtime, /v010StatusList/, "shared member statuses should receive semantic list enhancement");
assert.match(runtime, /setAttribute\("role", "list"\)/, "shared member status container should identify as a list");
assert.match(runtime, /setAttribute\("role", "listitem"\)/, "each shared member status should identify as a list item");
assert.match(runtime, /Meetup member status/, "shared member status list should expose an accessible label");
assert.doesNotMatch(runtime, /MutationObserver/, "accessibility enhancements should be event-first instead of observing the whole document");
assert.match(runtime, /nvs-shared-live-change/, "shared-live lifecycle events should refresh accessibility semantics");
assert.match(runtime, /nvs-live-plan-synced/, "plan sync should refresh accessibility semantics");
assert.match(runtime, /nvs-shared-view-resumed/, "Safari shared-view resume should refresh accessibility semantics");
assert.match(runtime, /visibilitychange/, "foreground resume should refresh accessibility semantics");
assert.match(runtime, /if \(!document\.hidden\) enhance\(\)/, "hidden pages should not perform accessibility rescans");

assert.match(styles, /min-width:44px;min-height:44px/, "important touch controls should meet a 44px minimum target");
assert.match(styles, /:focus-visible/, "keyboard users should receive a visible focus indicator");
assert.match(styles, /prefers-reduced-motion:\s*reduce/, "the app should honor the reduced-motion preference");
assert.match(styles, /animation-duration:\.001ms/, "reduced-motion mode should suppress animated transitions globally");
assert.match(styles, /forced-colors:\s*active/, "high-contrast/forced-colors environments should receive a compatible fallback");

console.log("accessibility-smoke: event-first dialog, live-region, semantic-list, motion and touch-target contracts passed");
