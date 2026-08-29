const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("ux-v051.js", "utf8");
const legacySource = fs.readFileSync("places.js", "utf8");

assert.doesNotMatch(
  source,
  /let\s+photonController\s*=/,
  "place search must not share one global Photon AbortController across independent fields",
);
assert.match(
  source,
  /async function photonSearch\(query, requestState = null\)/,
  "Photon search must accept request-scoped cancellation state",
);
assert.match(
  source,
  /signal:\s*controller\.signal/,
  "each Photon request must use its own AbortController",
);
assert.match(
  source,
  /if \(requestState\) requestState\.photonController = controller;/,
  "the active controller must be owned by the invoking search scope",
);
assert.match(
  source,
  /if \(requestState\?\.photonController === controller\) requestState\.photonController = null;/,
  "an older request must not clear a newer request's controller",
);
assert.match(
  source,
  /function cancelOriginSearch\(state\)[\s\S]*?state\.generation \+= 1;[\s\S]*?state\.photonController\?\.abort\(\);/,
  "origin cancellation must invalidate the active generation as well as abort network work",
);
assert.match(
  source,
  /closeAllOriginResults\(except = null\)[\s\S]*?cancelOriginSearch\(state\);[\s\S]*?aria-expanded/,
  "hiding an origin result surface must invalidate its pending search",
);
assert.match(
  source,
  /const generation = state\.generation;[\s\S]*?state\.generation !== generation[\s\S]*?!state\.results\.classList\.contains\("open"\)/,
  "origin completions must be generation-owned and unable to repaint a closed surface",
);
assert.match(
  source,
  /control\.addEventListener\("focusout"[\s\S]*?cancelOriginSearch\(state\);/,
  "keyboard blur from an origin control must invalidate pending search work",
);
assert.match(
  source,
  /const found = await searchPlaces\(query, state\);/,
  "origin searches must pass their own state into place search",
);
assert.match(
  source,
  /photonController:\s*null,[\s\S]*?generation:\s*0/,
  "origin search state must carry request-scoped cancellation and generation ownership",
);
assert.match(
  source,
  /const searchState = \{ photonController: null, generation: 0 \};/,
  "destination search must have independent cancellation and generation state",
);
assert.match(
  source,
  /const found = await searchPlaces\(clean, searchState\);/,
  "destination search must use its own request scope",
);
assert.match(
  source,
  /const cancelSearch = \(\) => \{[\s\S]*?searchState\.generation \+= 1;[\s\S]*?searchState\.photonController\?\.abort\(\);/,
  "destination cancellation must invalidate cached and network completions",
);
assert.match(
  source,
  /searchState\.generation !== generation[\s\S]*?!dialog\.open[\s\S]*?input\.value\.trim\(\) !== query\.trim\(\)/,
  "destination completions must not repaint a closed or superseded dialog even for the same query",
);
assert.match(
  source,
  /dialog\.addEventListener\("close", cancelSearch\);/,
  "closing the destination dialog must cancel pending search work",
);
assert.match(
  source,
  /dialog\.openSearch = \(\) => \{\s*cancelSearch\(\);/,
  "reopening destination search must invalidate any prior completion before resetting UI",
);

assert.match(
  legacySource,
  /let searchGeneration = 0;/,
  "the directly loaded legacy place dialog must also own a search generation",
);
assert.match(
  legacySource,
  /function invalidateSearch\([\s\S]*?searchGeneration \+= 1;[\s\S]*?searchController\?\.abort\(\);[\s\S]*?searchController = null;/,
  "legacy search invalidation must cancel timers/network work and advance generation",
);
assert.match(
  legacySource,
  /dialog\.addEventListener\("close", \(\) => invalidateSearch\(\{ clearActive: true \}\)\);/,
  "closing the legacy dialog must invalidate pending and cached completions",
);
assert.match(
  legacySource,
  /function openSearch\(select\) \{\s*invalidateSearch\(\{ clearActive: true \}\);/,
  "reopening legacy search must invalidate the previous surface before assigning a new target",
);
assert.match(
  legacySource,
  /const generation = \+\+searchGeneration;[\s\S]*?generation !== searchGeneration \|\| !placeDialog\.dialog\.open/,
  "legacy success completions must be generation-owned and unable to repaint a closed dialog",
);
assert.match(
  legacySource,
  /error\?\.name === "AbortError" \|\| generation !== searchGeneration \|\| !placeDialog\.dialog\.open/,
  "legacy failure completions must not overwrite a closed or superseded search state",
);
assert.match(
  legacySource,
  /if \(searchController === controller\) searchController = null;/,
  "an older legacy request must not clear a newer request controller",
);
assert.match(
  legacySource,
  /if \(!activeSelect \|\| !placeDialog\.dialog\.open\) return;/,
  "legacy result selection must require the active dialog surface",
);

assert.doesNotMatch(
  source,
  /watchPosition|getCurrentPosition/,
  "new place-search reliability must not add continuous or implicit location access",
);
assert.doesNotMatch(
  legacySource,
  /watchPosition/,
  "legacy place-search reliability must preserve one-shot location and never add continuous tracking",
);

console.log("place-search-isolation: modern + legacy cancellation, generation and closed-surface isolation passed");
