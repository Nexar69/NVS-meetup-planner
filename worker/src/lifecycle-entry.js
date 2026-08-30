import core from "./entry.js";
import { plansEquivalent } from "./plan-equivalence.js";

const DEFAULT_TTL = 72 * 60 * 60;
const PLAN_ID = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12}$/;
const SESSION_PREFIXES = ["p:", "caps:", "owner:", "meta:", "live:"];

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function liveTtl(env) {
  return Math.max(3600, Math.min(Number(env.PLAN_TTL_SECONDS) || DEFAULT_TTL, 7 * 24 * 60 * 60));
}

function expiryOptions(expiresAt) {
  const expires = Number(expiresAt);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expirySeconds = Math.ceil(expires / 1000);
  return expirySeconds > nowSeconds + 60
    ? { expiration: expirySeconds }
    : { expirationTtl: 60 };
}

async function readMeta(id, env) {
  if (!PLAN_ID.test(id)) return null;
  const raw = await env.PLANS.get(`meta:${id}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const expiresAt = Number(parsed?.expiresAt);
    return {
      revision: Math.max(1, Number(parsed?.revision) || 1),
      updatedAt: Number(parsed?.updatedAt) || null,
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null,
    };
  } catch {
    return null;
  }
}

async function readPlan(id, env) {
  if (!PLAN_ID.test(id)) return null;
  const raw = await env.PLANS.get(`p:${id}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function deleteSession(id, env) {
  await Promise.all(SESSION_PREFIXES.map((prefix) => env.PLANS.delete(`${prefix}${id}`)));
}

async function normalizeSessionExpiry(id, env, meta) {
  if (!PLAN_ID.test(id) || !meta?.expiresAt) return;
  const options = expiryOptions(meta.expiresAt);
  const keys = SESSION_PREFIXES.map((prefix) => `${prefix}${id}`);
  const values = await Promise.all(keys.map((key) => env.PLANS.get(key)));
  await Promise.all(keys.map((key, index) => {
    if (key.startsWith("meta:")) return env.PLANS.put(key, JSON.stringify(meta), options);
    const value = values[index];
    return value == null ? Promise.resolve() : env.PLANS.put(key, value, options);
  }));
}

function liveMatch(pathname) {
  return pathname.match(/^\/api\/live\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12})(?:\/(plan|capabilities))?$/);
}

function sessionIdFromPath(pathname) {
  const live = liveMatch(pathname);
  if (live) return live[1];
  const planApi = pathname.match(/^\/api\/plans\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12})$/);
  if (planApi) return planApi[1];
  const sharedPage = pathname.match(/^\/p\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12})\/?$/);
  return sharedPage?.[1] || "";
}

async function expiredResponse(id, env, pathname) {
  await deleteSession(id, env);
  if (pathname.startsWith("/p/")) {
    return new Response("This shared meetup has expired. Ask the organizer for a new Meet Schwerin link.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return json({ error: "not_found", expired: true, planId: id }, 404);
}

async function parseJsonResponse(response) {
  try { return await response.clone().json(); } catch { return null; }
}

async function parseJsonRequest(request) {
  try { return await request.clone().json(); } catch { return null; }
}

function replaceJson(response, data) {
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleCreatedPlan(response, env) {
  if (!response.ok) return response;
  const data = await parseJsonResponse(response);
  const id = String(data?.id || "");
  if (!PLAN_ID.test(id)) return response;

  const ttl = Math.max(3600, Math.min(Number(data?.expiresIn) || liveTtl(env), 7 * 24 * 60 * 60));
  const createdAt = Date.now();
  const expiresAt = createdAt + ttl * 1000;
  const current = await readMeta(id, env);
  const meta = {
    revision: current?.revision || Number(data?.revision) || 1,
    updatedAt: current?.updatedAt || createdAt,
    expiresAt,
  };
  await normalizeSessionExpiry(id, env, meta);

  return replaceJson(response, { ...data, expiresIn: ttl, expiresAt });
}

async function handleHealth(response) {
  if (!response.ok) return response;
  const data = await parseJsonResponse(response);
  if (!data) return response;
  return replaceJson(response, {
    ...data,
    capabilities: { ...(data.capabilities || {}), authoritativeExpiry: true },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const match = liveMatch(url.pathname);
    const sessionId = sessionIdFromPath(url.pathname);
    let beforeMeta = null;
    let beforePlan = null;
    let submittedPlan = null;
    let submittedLive = null;

    if (sessionId) {
      beforeMeta = await readMeta(sessionId, env);
      if (beforeMeta?.expiresAt && Date.now() >= beforeMeta.expiresAt) {
        return expiredResponse(sessionId, env, url.pathname);
      }
    }

    if (match?.[2] === "plan" && request.method === "POST") {
      [beforePlan, submittedPlan] = await Promise.all([
        readPlan(match[1], env),
        parseJsonRequest(request),
      ]);
    }

    if (match && !match[2] && request.method === "POST" && beforeMeta) {
      submittedLive = await parseJsonRequest(request);
      const submittedRevision = Number(submittedLive?.revision);
      if (Number.isInteger(submittedRevision) && submittedRevision > 0 && submittedRevision !== beforeMeta.revision) {
        return json({
          error: "plan_updated",
          planId: match[1],
          revision: beforeMeta.revision,
          updatedAt: beforeMeta.updatedAt,
          expiresAt: beforeMeta.expiresAt,
        }, 409, liveCorsHeaders(request, env));
      }
    }

    const response = await core.fetch(request, env, ctx);

    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(response);
    if (url.pathname === "/api/plans" && request.method === "POST") return handleCreatedPlan(response, env);
    if (!match || !response.ok || !beforeMeta?.expiresAt) return response;

    const id = match[1];
    const action = match[2] || "live";
    if (request.method === "GET" && action === "live") {
      const data = await parseJsonResponse(response);
      return data ? replaceJson(response, { ...data, expiresAt: beforeMeta.expiresAt }) : response;
    }

    if (request.method === "POST") {
      const data = await parseJsonResponse(response);
      const unchangedPlan = action === "plan" && beforePlan && submittedPlan && plansEquivalent(beforePlan, submittedPlan);
      const meta = unchangedPlan
        ? beforeMeta
        : action === "plan"
          ? {
              revision: Math.max(1, Number(data?.revision) || beforeMeta.revision || 1),
              updatedAt: Number(data?.updatedAt) || Date.now(),
              expiresAt: beforeMeta.expiresAt,
            }
          : beforeMeta;
      await normalizeSessionExpiry(id, env, meta);
      return data ? replaceJson(response, {
        ...data,
        ...(unchangedPlan ? { revision: meta.revision, updatedAt: meta.updatedAt, unchanged: true } : {}),
        expiresAt: meta.expiresAt,
      }) : response;
    }

    return response;
  },
};

function liveCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  let workerOrigin = "";
  let appOrigin = "";
  try { workerOrigin = new URL(request.url).origin; } catch {}
  try { appOrigin = new URL(env.APP_URL || "https://nexar69.github.io/NVS-meetup-planner/").origin; } catch {}
  const allowed = !origin || origin === appOrigin || origin === workerOrigin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed ? {
    "access-control-allow-origin": origin || workerOrigin,
    vary: "Origin",
  } : {};
}