const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../fair.js"), "utf8");

assert.match(source, /let frozenDocument = false/,
  "Fair Meetup should own an explicit frozen-document boundary");
assert.match(source, /let runGeneration = 0/,
  "Fair Meetup async work should be generation-owned");
assert.match(source, /function suspendDocument\(\)[\s\S]*frozenDocument = true[\s\S]*runGeneration \+= 1[\s\S]*running = false[\s\S]*cancelToast\(\)/,
  "pagehide should revoke routing/UI ownership and queued toast work");
assert.match(source, /function resumeDocument\(\)[\s\S]*frozenDocument = false[\s\S]*fairDialog\.dialog\.open[\s\S]*fairDialog\.dialog\.close\(\)[\s\S]*injectButton\(\)/,
  "pageshow should discard stale modal UI without silently restarting routing");
assert.match(source, /addEventListener\("pagehide", suspendDocument\)/,
  "Fair Meetup must explicitly suspend on pagehide");
assert.match(source, /addEventListener\("pageshow", resumeDocument\)/,
  "Fair Meetup must explicitly resume on pageshow");
assert.match(source, /async function runFairFinder\(\)[\s\S]*if \(frozenDocument \|\| running\) return;[\s\S]*const runId = \+\+runGeneration/,
  "direct Fair Meetup entry must fail closed while frozen and own a fresh generation");
assert.match(source, /Promise\.all\([\s\S]*fetchRoutes[\s\S]*fetchRoutes[\s\S]*if \(frozenDocument \|\| runId !== runGeneration\) return;/,
  "late route completions must not repaint after suspension or supersession");
assert.match(source, /await wait\(BETWEEN_CANDIDATES_MS\);[\s\S]*if \(frozenDocument \|\| runId !== runGeneration\) return;/,
  "inter-candidate delay completion must not resume work after ownership is revoked");
assert.match(source, /function renderResults\(items\) \{[\s\S]*if \(frozenDocument\) return;/,
  "result rendering must not mutate a frozen dialog");
assert.match(source, /function useCandidate\(candidate\) \{[\s\S]*if \(frozenDocument\) return;/,
  "direct candidate application must not submit planner state while suspended");
assert.doesNotMatch(source, /watchPosition\s*\(/,
  "Fair Meetup lifecycle hardening must not add continuous location tracking");
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/,
  "Fair Meetup run ownership should remain memory-only");

console.log("fair-bfcache-ownership: generation isolation, frozen DOM, no silent restart and privacy contracts passed");
