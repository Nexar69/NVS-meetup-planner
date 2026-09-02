const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.resolve(__dirname, "../service-worker.js"), "utf8");

assert.match(source, /const NETWORK_TIMEOUT_MS = 5_000/, "weak-network waits should remain bounded");
assert.match(
  source,
  /async function cacheFirstWithRefresh\(request\) \{[\s\S]*?const fresh = timedFetch\(request\)\.then\(\(response\) => updateCache\(request, response, false\)\);/,
  "cache-first assets must use the same bounded fetch as navigation/app-shell requests",
);
assert.doesNotMatch(
  source,
  /async function cacheFirstWithRefresh\(request\) \{[\s\S]*?const fresh = fetch\(request\)/,
  "cache-first refresh must not reintroduce an unbounded fetch",
);
assert.match(
  source,
  /if \(cached\) \{\s*fresh\.catch\(\(\) => \{\}\);\s*return cached;/,
  "a cached asset should remain immediately usable while a bounded refresh runs in the background",
);
assert.match(source, /if \(requestUrl\.pathname\.startsWith\("\/api\/"\)\) return;/, "live/share API traffic must remain outside service-worker caching");

console.log("service-worker-static-timeout: cache-first asset misses and refreshes are bounded on half-connected networks");
