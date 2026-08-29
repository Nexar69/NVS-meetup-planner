const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app.js', 'utf8');
const searchStart = source.indexOf('async function search(');
const searchEnd = source.indexOf('\nfunction setTargetRelative', searchStart);
assert.ok(searchStart >= 0 && searchEnd > searchStart, 'search() should remain discoverable for lifecycle regression coverage');

const search = source.slice(searchStart, searchEnd);
const generation = search.indexOf('const searchId = ++activeSearchId;');
const invalidTarget = search.indexOf('if (!target)');
const offline = search.indexOf('if (!navigator.onLine)');
const missingRouter = search.indexOf('if (!window.NVSTransit?.fetchRoutes)');

assert.ok(generation >= 0, 'every search must claim a fresh generation');
assert.ok(generation < invalidTarget, 'invalid-target searches must invalidate older in-flight live requests');
assert.ok(generation < offline, 'offline fallback searches must invalidate older in-flight live requests');
assert.ok(generation < missingRouter, 'module fallback searches must invalidate older in-flight live requests');

for (const marker of ['if (!target)', 'if (!navigator.onLine)', 'if (!window.NVSTransit?.fetchRoutes)']) {
  const start = search.indexOf(marker);
  const end = search.indexOf('\n  }', start);
  const block = search.slice(start, end);
  assert.match(block, /setSearching\(false\);/, `${marker} must clear a previous loading state before returning`);
}

const staleGuards = search.match(/if \(searchId !== activeSearchId\) return;/g) || [];
assert.ok(staleGuards.length >= 2, 'both resolved and rejected stale live requests must remain unable to repaint');
assert.match(search, /if \(searchId === activeSearchId\) setSearching\(false\);/, 'only the current generation may clear its own loading state');

assert.doesNotMatch(source, /watchPosition\s*\(/, 'base planner must not introduce continuous/background GPS tracking');

console.log('Base search generation isolation regression passed.');
