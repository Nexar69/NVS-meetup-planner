const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('group.js', 'utf8');
const searchStart = source.indexOf('async function groupSearch(');
const searchEnd = source.indexOf('\n  document.addEventListener("pointerdown"', searchStart);
assert.ok(searchStart >= 0 && searchEnd > searchStart, 'groupSearch() should remain discoverable for lifecycle regression coverage');

const search = source.slice(searchStart, searchEnd);
const generation = search.indexOf('const id = ++searchSequence;');
const missingOrigin = search.indexOf('if (missing)');
const invalidTarget = search.indexOf('if (!target || !destination)');
const offline = search.indexOf('if (!navigator.onLine)');
const missingRouter = search.indexOf('if (!window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommendGroup)');

assert.ok(generation >= 0, 'every group search must claim a fresh generation');
assert.ok(generation < missingOrigin, 'missing-origin searches must invalidate older in-flight group requests');
assert.ok(generation < invalidTarget, 'invalid-target searches must invalidate older in-flight group requests');
assert.ok(generation < offline, 'offline fallback searches must invalidate older in-flight group requests');
assert.ok(generation < missingRouter, 'module fallback searches must invalidate older in-flight group requests');

for (const marker of [
  'if (missing)',
  'if (!target || !destination)',
  'if (!navigator.onLine)',
  'if (!window.NVSTransit?.fetchRoutes || !window.NVSRecommend?.recommendGroup)',
]) {
  const start = search.indexOf(marker);
  const end = search.indexOf('\n    }', start);
  const block = search.slice(start, end);
  assert.match(block, /setSearching\(false\);/, `${marker} must clear a previous loading state before returning`);
}

const staleGuards = search.match(/if \(id !== searchSequence\) return;/g) || [];
assert.ok(staleGuards.length >= 2, 'both resolved and rejected stale group requests must remain unable to repaint');
assert.match(search, /if \(id === searchSequence\) setSearching\(false\);/, 'only the current group-search generation may clear its own loading state');

assert.doesNotMatch(source, /watchPosition\s*\(/, 'group planner must not introduce continuous/background GPS tracking');

console.log('Group search generation isolation regression passed.');
