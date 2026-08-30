const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class MemoryKV {
  constructor() {
    this.map = new Map();
    this.options = new Map();
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async put(key, value, options = {}) {
    this.map.set(key, String(value));
    this.options.set(key, { ...options });
  }

  async delete(key) {
    this.map.delete(key);
    this.options.delete(key);
  }
}

function samplePlan() {
  return {
    v: 1,
    view: "group",
    focus: -1,
    members: [
      { name: "You", color: "#2563eb", origin: { label: "Lankow", lat: 53.64883, lon: 11.36256 } },
      { name: "Friend", color: "#db2777", origin: { label: "Marienplatz", lat: 53.62878, lon: 11.41065 } },
    ],
    destination: { label: "Gymnasium Neumühler Schule", lat: 53.6332, lon: 11.3715 },
    priority: [0],
    mode: "together",
    timing: "target",
    date: "2026-08-25",
    time: "08:00",
    createdAt: Date.now(),
  };
}

(async () => {
  const entryPath = path.resolve(__dirname, "../worker/src/lifecycle-entry.js");
  const worker = (await import(pathToFileURL(entryPath).href)).default;
  const env = {
    APP_URL: "https://nexar69.github.io/NVS-meetup-planner/",
    PLAN_TTL_SECONDS: "7200",
    PLANS: new MemoryKV(),
  };
  const origin = "https://nexar69.github.io";
  const workerOrigin = "https://meet-schwerin.example";

  const health = await worker.fetch(new Request(`${workerOrigin}/api/health`), env, {});
  const healthData = await health.json();
  assert.equal(healthData.capabilities.authoritativeExpiry, true, "health contract should advertise authoritative expiry support");

  const create = await worker.fetch(new Request(`${workerOrigin}/api/plans`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ plan: samplePlan() }),
  }), env, {});
  assert.equal(create.status, 201);
  const created = await create.json();
  assert.equal(created.expiresIn, 7200);
  assert.ok(Number.isFinite(created.expiresAt));
  assert.ok(created.expiresAt > Date.now() + 7_000_000 && created.expiresAt <= Date.now() + 7_300_000);

  const id = created.id;
  const meta = JSON.parse(await env.PLANS.get(`meta:${id}`));
  assert.equal(meta.expiresAt, created.expiresAt, "authoritative expiry must be persisted in session metadata");

  const sessionKeys = [`p:${id}`, `caps:${id}`, `owner:${id}`, `meta:${id}`];
  const expirations = sessionKeys.map((key) => env.PLANS.options.get(key)?.expiration);
  assert.ok(expirations.every(Number.isFinite), "new session records should use an absolute KV expiration");
  assert.equal(new Set(expirations).size, 1, "plan, owner, capabilities and metadata must share one absolute KV deadline");

  const liveBefore = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`), env, {});
  const liveBeforeData = await liveBefore.json();
  assert.equal(liveBeforeData.expiresAt, created.expiresAt, "viewer live state must expose the authoritative expiry timestamp");

  const checkin = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: created.memberKeys[0], status: "left", revision: 1 }),
  }), env, {});
  assert.equal(checkin.status, 200);
  assert.equal((await checkin.json()).expiresAt, created.expiresAt);
  assert.equal(env.PLANS.options.get(`live:${id}`)?.expiration, expirations[0], "live state must be normalized onto the same absolute expiry");

  // A voluntary note is route-derived. If the organizer changes the plan after
  // the viewer loaded revision 1, the stale write must be rejected before the
  // core live-state handler mutates KV.
  const changedPlan = samplePlan();
  changedPlan.destination = { ...changedPlan.destination, label: "Updated meetup" };
  const changed = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}/plan`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ key: created.ownerKey, plan: changedPlan }),
  }), env, {});
  assert.equal(changed.status, 200);
  const changedData = await changed.json();
  assert.equal(changedData.revision, 2);

  const staleCheckin = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: created.memberKeys[0], status: "missed", note: "Old route", revision: 1 }),
  }), env, {});
  assert.equal(staleCheckin.status, 409, "check-ins derived from an older organizer revision must fail closed");
  const staleData = await staleCheckin.json();
  assert.equal(staleData.error, "plan_updated");
  assert.equal(staleData.revision, 2);
  assert.equal(staleData.expiresAt, created.expiresAt);

  const afterStale = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`), env, {});
  const afterStaleData = await afterStale.json();
  assert.equal(afterStaleData.members["0"].status, "left", "rejected stale writes must not mutate live state");

  const freshCheckin = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: created.memberKeys[0], status: "arrived", revision: 2 }),
  }), env, {});
  assert.equal(freshCheckin.status, 200, "the current organizer revision should still permit voluntary check-ins");

  const forbiddenStale = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: created.memberKeys[0], status: "missed", revision: 1 }),
  }), env, {});
  assert.equal(forbiddenStale.status, 403, "stale-revision hardening must not bypass the existing origin policy");

  const replan = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}/plan`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ key: created.ownerKey, plan: samplePlan() }),
  }), env, {});
  assert.equal(replan.status, 200);
  const replanData = await replan.json();
  assert.equal(replanData.expiresAt, created.expiresAt, "organizer replans must not silently extend session lifetime");
  const metaAfterReplan = JSON.parse(await env.PLANS.get(`meta:${id}`));
  assert.equal(metaAfterReplan.expiresAt, created.expiresAt, "replan metadata must retain the original deadline");

  const rotate = await worker.fetch(new Request(`${workerOrigin}/api/live/${id}/capabilities`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ key: created.ownerKey, member: 0 }),
  }), env, {});
  assert.equal(rotate.status, 200);
  assert.equal((await rotate.json()).expiresAt, created.expiresAt, "capability rotation must not extend session lifetime");
  assert.equal(env.PLANS.options.get(`caps:${id}`)?.expiration, expirations[0]);

  // Legacy sessions without expiresAt remain compatible and must not fabricate an exact deadline.
  const legacyId = "AbC2345";
  await env.PLANS.put(`p:${legacyId}`, JSON.stringify(samplePlan()));
  const legacy = await worker.fetch(new Request(`${workerOrigin}/api/live/${legacyId}`), env, {});
  assert.equal(legacy.status, 200);
  const legacyData = await legacy.json();
  assert.equal("expiresAt" in legacyData, false, "legacy sessions should stay readable without pretending to know an exact expiry");

  // The logical deadline must be enforced even if KV retains a record briefly near its minimum TTL boundary.
  await env.PLANS.put(`meta:${id}`, JSON.stringify({ revision: 3, updatedAt: Date.now(), expiresAt: Date.now() - 1 }));
  const expiredPage = await worker.fetch(new Request(`${workerOrigin}/p/${id}`), env, {});
  assert.equal(expiredPage.status, 404, "expired shared pages must stop resolving at the exact logical deadline");
  assert.match(await expiredPage.text(), /expired/i);
  for (const prefix of ["p:", "caps:", "owner:", "meta:", "live:"]) {
    assert.equal(await env.PLANS.get(`${prefix}${id}`), null, `expired session key ${prefix}${id} should be cleaned up`);
  }

  console.log("worker-expiry: authoritative deadline and stale-revision check-in ownership passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});