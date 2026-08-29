const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const mod = await import(pathToFileURL(path.resolve(__dirname, "../worker/src/plan-equivalence.js")).href);
  const base = {
    v: 1,
    view: "group",
    focus: -1,
    members: [
      { name: "You", color: "#2563eb", origin: { label: "A", lat: 53.6, lon: 11.4 } },
      { name: "Friend", color: "#db2777", origin: { label: "B", lat: 53.61, lon: 11.41 } },
    ],
    destination: { label: "Meet", lat: 53.62, lon: 11.42 },
    priority: [0], mode: "together", timing: "target", date: "2026-08-25", time: "08:00", createdAt: 1,
  };

  const same = structuredClone(base);
  same.createdAt = 999999;
  same.view = "person";
  same.focus = 0;
  assert.equal(mod.plansEquivalent(base, same), true, "transport-equivalent plans must not create fake revisions");

  const changedTime = structuredClone(base);
  changedTime.time = "08:05";
  assert.equal(mod.plansEquivalent(base, changedTime), false);

  const changedOrigin = structuredClone(base);
  changedOrigin.members[1].origin.lat += 0.001;
  assert.equal(mod.plansEquivalent(base, changedOrigin), false);

  const asapA = structuredClone(base);
  asapA.timing = "asap";
  asapA.date = "";
  asapA.time = "";
  const asapB = structuredClone(asapA);
  asapB.createdAt = 123456;
  assert.equal(mod.plansEquivalent(asapA, asapB), true, "ASAP plans with only volatile metadata changes must remain equivalent");

  assert.equal(mod.plansEquivalent(null, base), false);
  console.log("worker-plan-equivalence: no-op plan updates are distinguishable from real shared-plan changes");
})().catch((error) => { console.error(error); process.exit(1); });
