const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('shared-live-v010.js', 'utf8');

// A shared viewer must establish its baseline revision once, then only surface
// a reload prompt for a strictly newer revision. Equal poll revisions are the
// normal steady state and must never create a recurring "Plan updated" banner.
assert.match(source, /if \(loadedRevision == null\) loadedRevision = revision;/,
  'shared live should establish the initially loaded revision');
assert.match(source, /else if \(revision > loadedRevision\) pendingRevision = revision;/,
  'shared live should only flag a strictly newer plan revision');
assert.doesNotMatch(source, /revision\s*>=\s*loadedRevision/,
  'equal revisions must not be treated as plan updates');

// While a real update is pending, check-ins are deliberately paused so a
// viewer cannot post status against a route they have not reloaded yet.
assert.match(source, /button\.disabled = sending \|\| pendingRevision != null/,
  'check-in actions should pause while a newer plan is pending');
assert.match(source, /Reload the updated plan before posting another check-in\./,
  'the pending-update state should explain why check-ins are paused');

// The update control must remain a native button with an explicit click path.
// This guards the real-device regression where repeated update prompts could
// eventually leave the UI with no actionable reload control.
assert.match(source, /id="v010ReloadPlan"/,
  'shared live should render a dedicated reload button');
assert.match(source, /#v010ReloadPlan"\)\?\.addEventListener\("click", \(\) => window\.location\.reload\(\)\)/,
  'the reload button should always have an explicit navigation handler');

// The backend lifecycle layer is responsible for preventing semantically
// identical organizer syncs from incrementing the revision in the first place.
const lifecycle = fs.readFileSync('worker/src/lifecycle-entry.js', 'utf8');
assert.match(lifecycle, /plansEquivalent|planEquivalent|samePlan|semantic/i,
  'worker lifecycle should contain semantic plan-equivalence handling');
assert.match(lifecycle, /revision/i,
  'worker lifecycle should preserve/reason about plan revisions');

console.log('shared plan update banner contracts OK');
