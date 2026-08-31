const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../share-v072.js'), 'utf8');

assert.match(source, /let deliveryGeneration = 0/,
  'share delivery should retain an in-memory generation owner');
assert.match(source, /function invalidateDelivery\(\)[\s\S]*deliveryGeneration \+= 1;[\s\S]*deliveryInflight = null;/,
  'share delivery invalidation must revoke pending completion ownership');
assert.match(source, /window\.addEventListener\("pagehide", invalidateDelivery\)/,
  'pagehide must revoke any in-flight Web Share or clipboard delivery');
assert.match(source, /generation !== deliveryGeneration/,
  'late async share preparation must fail closed after invalidation');
assert.match(source, /navigator\.clipboard\?\.writeText[\s\S]*generation === deliveryGeneration/,
  'clipboard completion must only announce while its delivery generation still owns the document');
assert.match(source, /error\?\.name !== "AbortError"/,
  'user-cancelled Web Share should not be surfaced as an application failure');

assert.match(source, /credentials: "omit"/,
  'short-link creation must not attach ambient credentials');
assert.match(source, /headers: \{ "content-type": "application\/json", "x-meet-schwerin": "1" \}/,
  'short-link creation should keep its narrow explicit request contract');
assert.match(source, /value\.length > 16000/,
  'encoded shared plans should retain a defensive decode-size ceiling');
assert.match(source, /raw\.members\.slice\(0, 6\)/,
  'shared-plan input should retain its member-count bound');
assert.match(source, /slice\(0, 24\)/,
  'shared member names should remain bounded before rendering or reshare');
assert.match(source, /slice\(0, 100\)/,
  'shared place labels should remain bounded before rendering or reshare');

assert.doesNotMatch(source, /watchPosition/i,
  'sharing must never introduce continuous location tracking');
assert.doesNotMatch(source, /getCurrentPosition/i,
  'sharing a route must not silently request one-shot location either');
assert.doesNotMatch(source, /indexedDB/i,
  'share delivery state must remain ephemeral and must not gain durable IndexedDB state');

console.log('share-delivery-privacy: async delivery ownership and privacy bounds are locked');
