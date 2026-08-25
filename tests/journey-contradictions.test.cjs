const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.resolve(__dirname, "../trip-guidance-v0111.js"), "utf8");
const window = {
  NVSShare: { getSharedPlan: () => null, getFocusIndex: () => -1 },
  addEventListener() {},
};
const document = {
  hidden: true,
  addEventListener() {},
  getElementById() { return null; },
};
class MutationObserver { observe() {} disconnect() {} }

vm.runInNewContext(source, {
  window,
  document,
  MutationObserver,
  Intl,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Array,
  Object,
  setTimeout,
  clearTimeout,
});

const guidanceForRoute = window.NVSTripGuidance0111.guidanceForRoute;
const at = (minute) => new Date(Date.UTC(2026, 7, 25, 8, minute, 0));
const now = at(10).getTime();
const route = {
  segments: [
    {
      mode: "TRAM",
      modeLabel: "Tram",
      line: "2",
      from: "Rahlstedter Straße",
      to: "Stauffenbergstraße",
      departure: at(0),
      arrival: at(15),
    },
    {
      mode: "TRAM",
      modeLabel: "Tram",
      line: "3",
      from: "Stauffenbergstraße",
      to: "Krebsförden",
      departure: at(18),
      arrival: at(25),
    },
  ],
};

function text(model) {
  return `${model?.eyebrow || ""} ${model?.title || ""} ${model?.detail || ""}`;
}

const cases = [
  {
    status: "missed",
    forbidden: [/currently on Tram 2/i, /confirmed on board/i, /be ready to board/i],
    required: [/missed connection/i],
  },
  {
    status: "arrived",
    forbidden: [/get ready to leave/i, /currently on Tram 2/i, /be ready to board/i, /next planned service/i],
    required: [/at the meetup/i],
  },
  {
    status: "at-stop",
    forbidden: [/currently on Tram 2/i, /confirmed on board/i],
    required: [/at a stop/i],
  },
  {
    status: "on-vehicle",
    forbidden: [/you're at a stop/i, /missed connection/i, /at the meetup/i],
    required: [/confirmed on board/i],
  },
];

for (const item of cases) {
  const model = guidanceForRoute(route, now, { status: item.status });
  const output = text(model);
  for (const pattern of item.required) assert.match(output, pattern, `${item.status} should surface its explicit voluntary state`);
  for (const pattern of item.forbidden) assert.doesNotMatch(output, pattern, `${item.status} must not produce contradictory guidance: ${pattern}`);
}

const ordinary = text(guidanceForRoute(route, now, null));
assert.match(ordinary, /Tram 2|Stauffenbergstraße/, "timetable guidance should still work without a voluntary override");

console.log("journey-contradictions: explicit voluntary states cannot produce mutually impossible guidance");
