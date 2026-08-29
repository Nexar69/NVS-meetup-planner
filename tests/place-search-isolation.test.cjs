const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("ux-v051.js", "utf8");

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
  /const found = await searchPlaces\(query, state\);/,
  "origin searches must pass their own state into place search",
);
assert.match(
  source,
  /photonController:\s*null/,
  "origin search state must carry request-scoped cancellation ownership",
);
assert.match(
  source,
  /const searchState = \{ photonController: null \};/,
  "destination search must have independent cancellation state",
);
assert.match(
  source,
  /const found = await searchPlaces\(clean, searchState\);/,
  "destination search must use its own request scope",
);
assert.match(
  source,
  /dialog\.addEventListener\("close", cancelSearch\);/,
  "closing the destination dialog must cancel pending search work",
);
assert.match(
  source,
  /state\.photonController\?\.abort\(\);\s*\n\s*state\.photonController = null;/,
  "superseded origin searches must cancel their own in-flight request immediately",
);
assert.doesNotMatch(
  source,
  /watchPosition|getCurrentPosition/,
  "place-search reliability must not add continuous or implicit location access",
);

console.log("place-search-isolation: independent origin/destination cancellation ownership passed");
