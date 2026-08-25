const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const recovery = fs.readFileSync(path.join(root, "recovery-v0111.js"), "utf8");

assert.match(recovery, /function viewContext\(/, "Recovery Desk should distinguish organizer and viewer ownership");
assert.match(recovery, /kind:\s*"organizer"/, "organizer recovery context should exist");
assert.match(recovery, /kind:\s*"person"/, "personal-view recovery context should exist");
assert.match(recovery, /kind:\s*"group"/, "whole-group viewer recovery context should exist");
assert.match(recovery, /RECOVERY · ORGANIZER/, "organizer scope should be visible in the Recovery Desk");
assert.match(recovery, /RECOVERY · GROUP VIEW/, "group-view scope should be visible in the Recovery Desk");
assert.match(recovery, /Replan my route/, "personal viewers should receive a personal-route action");
assert.match(recovery, /Replan this view/, "group viewers should be told that replanning is local to their view");
assert.match(recovery, /Refresh & replan group/, "organizers should receive an organizer-level group action");
assert.match(recovery, /does not edit the organizer's shared meetup/, "viewer recovery copy should not imply organizer-plan ownership");
assert.match(recovery, /function relevantForContext\(/, "member-scoped recovery alerts should be filtered by viewer ownership");
assert.match(recovery, /item\.memberIndex === context\.focus/, "personal viewers should only receive another member-index alert when it is their own");
assert.match(recovery, /String\(item\.memberId\) === context\.memberId/, "personal viewers should only receive member-id alerts for their own route");
assert.match(recovery, /getViewContext:\s*viewContext/, "ownership context should remain inspectable for regression testing");
assert.match(recovery, /isRelevantForView:\s*relevantForContext/, "recovery relevance should remain inspectable for regression testing");
assert.doesNotMatch(recovery, /navigator\.geolocation|watchPosition|getCurrentPosition/, "ownership-aware recovery must not introduce location tracking");

console.log("recovery-ownership: organizer, group-view and personal-view contracts passed");
