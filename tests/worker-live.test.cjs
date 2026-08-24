const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

class MemoryKV {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async put(key, value) {
    this.map.set(key, String(value));
  }

  async delete(key) {
    this.map.delete(key);
  }

  keys(prefix = "") {
    return [...this.map.keys()].filter((key) => key.startsWith(prefix));
  }
}

function samplePlan(destinationLabel = "Gymnasium Neumühler Schule") {
  return {
    v: 1,
    view: "group",
    focus: -1,
    members: [
      { name: "You", color: "#2563eb", origin: { label: "Lankow", lat: 53.64883, lon: 11.36256 } },
      { name: "Friend", color: "#db2777", origin: { label: "Marienplatz", lat: 53.62878, lon: 11.41065 } },
    ],
    destination: { label: destinationLabel, lat: 53.6332, lon: 11.3715 },
    priority: [0],
    mode: "together",
    timing: "target",
    date: "2026-08-25",
    time: "08:00",
    createdAt: Date.now(),
  };
}

(async () => {
  const entryPath = path.resolve(__dirname, "../worker/src/entry.js");
  const worker = (await import(pathToFileURL(entryPath).href)).default;
  assert.equal(typeof worker?.fetch, "function", "Worker entry must export fetch()");

  const env = {
    APP_URL: "https://nexar69.github.io/NVS-meetup-planner/",
    PLAN_TTL_SECONDS: "259200",
    PLANS: new MemoryKV(),
  };
  const origin = "https://nexar69.github.io";
  const workerOrigin = "https://meet-schwerin.example";

  const health = await worker.fetch(new Request(`${workerOrigin}/api/health`), env, {});
  assert.equal(health.status, 200);
  const healthData = await health.json();
  assert.equal(healthData.release, "v0.11.1");
  assert.equal(healthData.capabilities.sharedCheckins, true);
  assert.equal(healthData.capabilities.publicPlanIdLength, 11);

  const forbiddenCreate = await worker.fetch(new Request(`${workerOrigin}/api/plans`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ plan: samplePlan() }),
  }), env, {});
  assert.equal(forbiddenCreate.status, 403, "cross-origin sites must not be allowed to create stored meetup plans");

  const legacyId = "AbC2345";
  await env.PLANS.put(`p:${legacyId}`, JSON.stringify(samplePlan("Legacy meetup")));
  const legacyRead = await worker.fetch(new Request(`${workerOrigin}/api/live/${legacyId}`), env, {});
  assert.equal(legacyRead.status, 200, "existing legacy short IDs must remain readable after ID hardening");
  const legacyLive = await legacyRead.json();
  assert.equal(legacyLive.planId, legacyId);
  assert.equal(legacyLive.memberCount, 2);

  const legacyWrite = await worker.fetch(new Request(`${workerOrigin}/api/live/${legacyId}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, status: "left", key: "" }),
  }), env, {});
  assert.equal(legacyWrite.status, 403, "legacy links without v0.10 capability keys must remain check-in read-only");
  await env.PLANS.delete(`p:${legacyId}`);

  const create = await worker.fetch(new Request(`${workerOrigin}/api/plans`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ plan: samplePlan() }),
  }), env, {});
  assert.equal(create.status, 201, "plan creation should succeed");
  const created = await create.json();
  assert.equal(created.id.length, 11, "new public plan IDs should use the hardened 11-character format");
  assert.match(created.url, new RegExp(`/p/${created.id}$`));
  assert.equal(Array.isArray(created.memberKeys), true);
  assert.equal(created.memberKeys.length, 2);
  assert.equal(typeof created.ownerKey, "string");
  assert.ok(created.ownerKey.length >= 20);

  const planKeys = env.PLANS.keys("p:");
  assert.deepEqual(planKeys, [`p:${created.id}`], "legacy short plan key should be migrated away before the URL is returned");
  assert.ok(await env.PLANS.get(`caps:${created.id}`), "member capabilities should follow the hardened plan ID");
  assert.ok(await env.PLANS.get(`owner:${created.id}`), "owner capability should follow the hardened plan ID");

  const rejected = await worker.fetch(new Request(`${workerOrigin}/api/live/${created.id}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: "wrong-key", status: "left", note: "test" }),
  }), env, {});
  assert.equal(rejected.status, 403, "a personal check-in must reject the wrong capability key");

  const accepted = await worker.fetch(new Request(`${workerOrigin}/api/live/${created.id}`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ member: 0, key: created.memberKeys[0], status: "left", note: "Tram 4" }),
  }), env, {});
  assert.equal(accepted.status, 200, "the matching personal capability should permit a check-in");
  const acceptedData = await accepted.json();
  assert.equal(acceptedData.members["0"].status, "left");
  assert.equal(acceptedData.members["0"].note, "Tram 4");

  const update = await worker.fetch(new Request(`${workerOrigin}/api/live/${created.id}/plan`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json", "x-meet-schwerin": "1" },
    body: JSON.stringify({ key: created.ownerKey, plan: samplePlan("Updated meetup") }),
  }), env, {});
  assert.equal(update.status, 200, "the organizer capability should update the existing shared plan");
  const updateData = await update.json();
  assert.equal(updateData.revision, 2);

  const live = await worker.fetch(new Request(`${workerOrigin}/api/live/${created.id}`), env, {});
  assert.equal(live.status, 200);
  const liveData = await live.json();
  assert.equal(liveData.revision, 2, "viewers should observe organizer plan revision changes");
  assert.equal(liveData.members["0"].status, "left", "live check-ins should survive organizer replans");

  console.log("worker-live: shared plan security, compatibility and coordination passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
