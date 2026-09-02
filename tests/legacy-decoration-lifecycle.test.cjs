const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

const convergence = read("convergence-ui.js");
const release = read("release-v080.js");

assert.match(convergence, /let recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\)/);
assert.match(convergence, /window\.addEventListener\("nvs-recommendations-cleared", clearRecommendations\)/);
assert.match(convergence, /function clearRecommendations\(\) \{\s*recommendationsActive = false;\s*cancelDecoration\(\);\s*if \(frozenDocument\) return;\s*clearGeneratedDecoration\(\);/s);
assert.match(convergence, /function decorateExisting\(\) \{\s*cancelDecoration\(\);\s*if \(frozenDocument \|\| !recommendationsActive\) return;/s);
assert.match(convergence, /decorateTimer = setTimeout\(\(\) => \{\s*decorateTimer = null;\s*if \(frozenDocument \|\| !recommendationsActive\) return;/s);
assert.match(convergence, /function activateRecommendations\(\) \{\s*if \(frozenDocument\) return;\s*recommendationsActive = true;\s*decorateExisting\(\);/s);
assert.match(convergence, /function resumeDocument\(\)[\s\S]*recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\)[\s\S]*if \(recommendationsActive\) decorateExisting\(\)[\s\S]*else clearGeneratedDecoration\(\)/s);

assert.match(release, /let recommendationsActive = Boolean\(window\.__NVS_LAST_RECOMMENDATIONS__\)/);
assert.match(release, /window\.addEventListener\("nvs-recommendations-cleared", clearRecommendations\)/);
assert.match(release, /function clearRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;\s*recommendationsActive = false;\s*cancelProviderDecoration\(\);\s*removeProviderDecoration\(\);/s);
assert.match(release, /function decorateProviders\(\) \{\s*cancelProviderDecoration\(\);\s*if \(lifecycleFrozen \|\| !recommendationsActive\) return;/s);
assert.match(release, /timer = setTimeout\(\(\) => \{\s*timer = null;\s*if \(lifecycleFrozen \|\| !recommendationsActive\) return;/s);
assert.match(release, /function activateRecommendations\(\) \{\s*if \(lifecycleFrozen\) return;\s*recommendationsActive = true;\s*decorateProviders\(\);/s);

for (const source of [convergence, release]) {
  assert.doesNotMatch(source, /watchPosition\s*\(/, "legacy decoration must not introduce continuous GPS");
}

console.log("legacy decoration lifecycle regression checks passed");