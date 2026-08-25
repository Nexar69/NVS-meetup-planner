const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const wrangler = read("worker/wrangler.toml");
const readme = read("worker/README.md");
const config = read("config.js");

assert.match(wrangler, /^name\s*=\s*"meet-schwerin"/m, "supported Cloudflare Worker name must remain meet-schwerin");
assert.match(wrangler, /^main\s*=\s*"src\/entry\.js"/m, "Worker entry point must remain worker/src/entry.js relative to worker/");
assert.match(wrangler, /binding\s*=\s*"PLANS"/, "Worker must retain the PLANS KV binding");
assert.match(wrangler, /APP_URL\s*=\s*"https:\/\/nexar69\.github\.io\/NVS-meetup-planner\/"/, "Worker CORS/app origin must match the GitHub Pages app");
assert.match(wrangler, /PLAN_TTL_SECONDS\s*=\s*"259200"/, "shared plan TTL should remain explicitly bounded to 72 hours");

assert.match(config, /configuredBackend\s*=\s*"https:\/\/meet-schwerin\.[^"]+\.workers\.dev"/, "browser config should target the supported meet-schwerin Worker project");
assert.match(readme, /project root is this `worker\/` directory/i, "deployment docs must state the Cloudflare project root");
assert.match(readme, /project is named \*\*`meet-schwerin`\*\*/i, "deployment docs must identify the supported Worker project");
assert.doesNotMatch(readme, /placeholder KV namespace id/i, "deployment docs must not claim the configured KV namespace is a placeholder");
assert.match(readme, /Do not change application code merely to satisfy an unintended duplicate deployment/i, "docs should distinguish duplicate Cloudflare projects from app regressions");

console.log("worker-config: Cloudflare deployment contract is internally consistent");
