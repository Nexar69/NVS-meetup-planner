import app from "./index.js";
import { vmvRestPlan } from "./vmv-rest.js";

const DEFAULT_APP_URL = "https://nexar69.github.io/NVS-meetup-planner/";
const DEFAULT_TTL = 72 * 60 * 60;
const PLAN_ID = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12}$/;
const LIVE_STATUSES = new Set(["left", "on-vehicle", "at-stop", "missed", "arrived", "clear"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function liveCors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const appOrigin = new URL(env.APP_URL || DEFAULT_APP_URL).origin;
  const workerOrigin = new URL(request.url).origin;
  const allowed = !origin || origin === appOrigin || origin === workerOrigin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) return null;
  return {
    "access-control-allow-origin": origin || workerOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-meet-schwerin",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function liveTtl(env) {
  return Math.max(3600, Math.min(Number(env.PLAN_TTL_SECONDS) || DEFAULT_TTL, 7 * 24 * 60 * 60));
}

function randomCapability() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let raw = "";
  bytes.forEach((byte) => { raw += String.fromCharCode(byte); });
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function readStoredPlan(id, env) {
  if (!PLAN_ID.test(id)) return null;
  const raw = await env.PLANS.get(`p:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function readCapabilities(id, env) {
  const raw = await env.PLANS.get(`caps:${id}`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => String(value || "")) : [];
  } catch {
    return [];
  }
}

async function readLiveState(id, env) {
  const raw = await env.PLANS.get(`live:${id}`);
  if (!raw) return { v: 1, updatedAt: null, members: {} };
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.v === 1 && parsed.members && typeof parsed.members === "object"
      ? parsed
      : { v: 1, updatedAt: null, members: {} };
  } catch {
    return { v: 1, updatedAt: null, members: {} };
  }
}

async function liveApi(request, env, id) {
  const cors = liveCors(request, env);
  if (!cors) return json({ error: "origin_not_allowed" }, 403);
  if (!PLAN_ID.test(id)) return json({ error: "invalid_plan_id" }, 400, cors);
  const plan = await readStoredPlan(id, env);
  if (!plan || !Array.isArray(plan.members)) return json({ error: "not_found" }, 404, cors);

  if (request.method === "GET") {
    const live = await readLiveState(id, env);
    return json({
      planId: id,
      memberCount: plan.members.length,
      updatedAt: live.updatedAt,
      members: live.members,
    }, 200, cors);
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
  const raw = await request.text();
  if (raw.length > 1500) return json({ error: "payload_too_large" }, 413, cors);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400, cors); }

  const member = Number(body?.member);
  const status = String(body?.status || "");
  if (!Number.isInteger(member) || member < 0 || member >= plan.members.length) return json({ error: "invalid_member" }, 400, cors);
  if (!LIVE_STATUSES.has(status)) return json({ error: "invalid_status" }, 400, cors);

  const capabilities = await readCapabilities(id, env);
  const suppliedKey = String(body?.key || "");
  if (!capabilities[member] || suppliedKey !== capabilities[member]) {
    return json({ error: "checkin_not_authorized" }, 403, cors);
  }

  const live = await readLiveState(id, env);
  if (status === "clear") {
    delete live.members[String(member)];
  } else {
    const note = String(body?.note || "").trim().replace(/\s+/g, " ").slice(0, 80);
    live.members[String(member)] = {
      status,
      note,
      at: Date.now(),
    };
  }
  live.v = 1;
  live.updatedAt = Date.now();
  await env.PLANS.put(`live:${id}`, JSON.stringify(live), { expirationTtl: liveTtl(env) });
  return json({ ok: true, planId: id, updatedAt: live.updatedAt, members: live.members }, 200, cors);
}

async function createPlanWithCapabilities(request, env, ctx) {
  let memberCount = 0;
  try {
    const body = await request.clone().json();
    memberCount = Math.max(0, Math.min(6, Array.isArray(body?.plan?.members) ? body.plan.members.length : Array.isArray(body?.members) ? body.members.length : 0));
  } catch {}

  const response = await app.fetch(request, env, ctx);
  if (!response.ok || !memberCount) return response;

  let data;
  try { data = await response.clone().json(); } catch { return response; }
  const id = String(data?.id || "");
  if (!PLAN_ID.test(id)) return response;

  const keys = Array.from({ length: memberCount }, () => randomCapability());
  await env.PLANS.put(`caps:${id}`, JSON.stringify(keys), { expirationTtl: liveTtl(env) });

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify({ ...data, memberKeys: keys }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function freshAppAsset(request, env) {
  const url = new URL(request.url);
  if (request.method !== "GET" || !/\.(?:js|css|html|webmanifest)$/i.test(url.pathname)) return null;
  const appBase = new URL(env.APP_URL || DEFAULT_APP_URL);
  const target = new URL(url.pathname.replace(/^\/+/, ""), appBase);
  const response = await fetch(target.toString(), {
    headers: { Accept: request.headers.get("Accept") || "*/*" },
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // The Workers.dev origin exists only to serve short-lived shared viewers and
    // backend APIs. Do not install the GitHub Pages PWA service worker here,
    // otherwise a dynamically injected shared plan could become an offline shell.
    if (url.pathname === "/service-worker.js") {
      return new Response("", {
        status: 404,
        headers: { "cache-control": "no-store" },
      });
    }

    const liveMatch = url.pathname.match(/^\/api\/live\/([A-Za-z0-9]+)$/);
    if (liveMatch && request.method === "OPTIONS") {
      const cors = liveCors(request, env);
      return cors ? new Response(null, { status: 204, headers: cors }) : json({ error: "origin_not_allowed" }, 403);
    }
    if (liveMatch && (request.method === "GET" || request.method === "POST")) {
      return liveApi(request, env, liveMatch[1]);
    }

    // New v0.10 plans receive one random capability per person. The group URL
    // never receives these keys; only a personal URL generated by the planner can
    // carry the corresponding key and post a voluntary check-in.
    if (url.pathname === "/api/plans" && request.method === "POST") {
      return createPlanWithCapabilities(request, env, ctx);
    }

    // Shared viewers proxy the GitHub Pages app. Code/config assets must stay
    // fresh so a short link cannot keep an old UI for several minutes after a
    // deployment. Images/icons can still use the older proxy cache in index.js.
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/p/")) {
      const fresh = await freshAppAsset(request, env);
      if (fresh) return fresh;
    }

    // Prefer the VMV-specific REST service used by current community VMV clients.
    // If it is unavailable or returns no usable journeys, fall through to the
    // existing raw VMV EFA bridge in index.js. The browser still keeps Transitous
    // as the final fallback, so one upstream cannot break the planner.
    if (url.pathname === "/api/vmv/plan" && request.method === "GET") {
      const restResponse = await vmvRestPlan(request, env);
      if (restResponse.ok) return restResponse;

      const efaResponse = await app.fetch(request, env, ctx);
      if (efaResponse.ok) return efaResponse;

      let restError = null;
      let efaError = null;
      try { restError = await restResponse.clone().json(); } catch {}
      try { efaError = await efaResponse.clone().json(); } catch {}

      const headers = new Headers(efaResponse.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "no-store");
      return new Response(JSON.stringify({
        error: "vmv_unavailable",
        primary: restError,
        secondary: efaError,
      }), { status: 502, headers });
    }

    return app.fetch(request, env, ctx);
  },
};
