const VMV_BASE = "https://fahrplanauskunft-mv.de/vmv-efa/";
const DEFAULT_APP_URL = "https://nexar69.github.io/NVS-meetup-planner/";
const DEFAULT_TTL = 72 * 60 * 60;
const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const appOrigin = new URL(env.APP_URL || DEFAULT_APP_URL).origin;
  const allowed = origin === appOrigin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-meet-schwerin",
    "access-control-max-age": "86400",
    vary: "Origin",
  } : {};
}

function isAllowedWriteOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const appOrigin = new URL(env.APP_URL || DEFAULT_APP_URL).origin;
  return origin === appOrigin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPoint(value) {
  const lat = safeNumber(value?.lat);
  const lon = safeNumber(value?.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, label: String(value?.label || "Place").slice(0, 100) };
}

function validatePlan(raw) {
  const plan = raw?.plan || raw;
  if (!plan || plan.v !== 1 || !Array.isArray(plan.members)) return null;
  const members = plan.members.slice(0, 6).map((member, index) => {
    const origin = validPoint(member?.origin);
    if (!origin) return null;
    return {
      name: String(member?.name || `Person ${index + 1}`).slice(0, 24),
      color: /^#[0-9a-f]{6}$/i.test(String(member?.color || "")) ? member.color : "#667085",
      origin,
    };
  }).filter(Boolean);
  if (members.length < 2) return null;
  const destination = validPoint(plan.destination);
  if (!destination) return null;
  return {
    v: 1,
    view: "group",
    focus: -1,
    members,
    destination,
    priority: Array.isArray(plan.priority) ? [...new Set(plan.priority.filter((index) => Number.isInteger(index) && index >= 0 && index < members.length))] : [],
    mode: ["together", "fastest", "easy"].includes(plan.mode) ? plan.mode : "together",
    timing: ["target", "asap"].includes(plan.timing) ? plan.timing : "target",
    date: /^\d{4}-\d{2}-\d{2}$/.test(plan.date || "") ? plan.date : "",
    time: /^\d{2}:\d{2}$/.test(plan.time || "") ? plan.time : "",
    createdAt: Number.isFinite(Number(plan.createdAt)) ? Number(plan.createdAt) : Date.now(),
  };
}

function randomId(length = 7) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join("");
}

function first(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== "") return value;
  return null;
}

function asDateString(...values) {
  const value = first(...values);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function coord(value) {
  const raw = value?.coord || value?.coordinate || value?.coords;
  if (Array.isArray(raw) && raw.length >= 2) {
    const lon = Number(raw[0]);
    const lat = Number(raw[1]);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
  }
  const lat = safeNumber(first(value?.lat, value?.latitude));
  const lon = safeNumber(first(value?.lon, value?.lng, value?.longitude));
  return lat != null && lon != null ? [lat, lon] : null;
}

function platform(value) {
  return String(first(value?.properties?.platformName, value?.properties?.platform, value?.platformName, value?.platform, value?.track) || "");
}

function locationName(value, fallback = "") {
  return String(first(value?.name, value?.disassembledName, value?.parent?.name, fallback) || "");
}

function productMode(transportation) {
  const text = `${transportation?.product?.name || ""} ${transportation?.name || ""} ${transportation?.description || ""}`.toLocaleLowerCase("de-DE");
  if (text.includes("tram") || text.includes("straßenbahn")) return "TRAM";
  if (text.includes("stadtbus") || text.includes("regionalbus") || text.includes("bus")) return "BUS";
  if (text.includes("s-bahn") || text.includes("s bahn")) return "SUBURBAN";
  if (text.includes("u-bahn") || text.includes("u bahn")) return "SUBWAY";
  if (text.includes("fähre") || text.includes("ferry") || text.includes("schiff")) return "FERRY";
  if (text.includes("walk") || text.includes("fuß") || text.includes("fuss")) return "WALK";
  const klass = Number(transportation?.product?.class);
  if (klass === 3) return "TRAM";
  if ([4, 5, 6].includes(klass)) return "BUS";
  if (klass === 1) return "SUBURBAN";
  if (klass === 2) return "SUBWAY";
  if (klass === 8) return "FERRY";
  return "RAIL";
}

function modeLabel(mode) {
  return { WALK: "Walk", TRAM: "Tram", BUS: "Bus", SUBURBAN: "S-Bahn", SUBWAY: "U-Bahn", FERRY: "Ferry", RAIL: "Train" }[mode] || "Transit";
}

function normalizedStop(stop) {
  if (!stop) return null;
  const arrival = asDateString(stop.arrivalTimeEstimated, stop.arrivalTimePlanned, stop.arrivalTime);
  const departure = asDateString(stop.departureTimeEstimated, stop.departureTimePlanned, stop.departureTime);
  return {
    name: locationName(stop),
    arrival,
    departure,
    track: platform(stop),
    point: coord(stop),
    cancelled: Boolean(stop.isCancelled || stop.cancelled),
  };
}

function normalizeLeg(leg, index) {
  const origin = leg.origin || leg.from || {};
  const destination = leg.destination || leg.to || {};
  const transportation = leg.transportation || {};
  const mode = productMode(transportation);
  const departure = asDateString(origin.departureTimeEstimated, origin.departureTimePlanned, leg.departureTimeEstimated, leg.departureTimePlanned, leg.departure);
  const arrival = asDateString(destination.arrivalTimeEstimated, destination.arrivalTimePlanned, leg.arrivalTimeEstimated, leg.arrivalTimePlanned, leg.arrival);
  const departureDate = departure ? new Date(departure) : null;
  const arrivalDate = arrival ? new Date(arrival) : null;
  const duration = departureDate && arrivalDate ? Math.max(1, Math.round((arrivalDate - departureDate) / 60000)) : null;
  const line = String(first(transportation.disassembledName, transportation.number, transportation.name, transportation.product?.name) || "").trim();
  const headsign = locationName(transportation.destination || leg.destination, "");
  const stops = Array.isArray(leg.stopSequence) ? leg.stopSequence : Array.isArray(leg.stops) ? leg.stops : [];
  const intermediateStops = stops.slice(1, Math.max(1, stops.length - 1)).map(normalizedStop).filter((stop) => stop?.name);
  const rawCoords = Array.isArray(leg.coords) ? leg.coords : Array.isArray(leg.coordinates) ? leg.coordinates : [];
  const geometry = rawCoords.map((point) => Array.isArray(point) && point.length >= 2 ? [Number(point[1]), Number(point[0])] : null)
    .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));

  return {
    index,
    mode,
    modeLabel: modeLabel(mode),
    line: mode === "WALK" ? "" : line,
    title: mode === "WALK" ? "Walk" : `${modeLabel(mode)}${line ? ` ${line}` : ""}`,
    from: locationName(origin, "Start"),
    to: locationName(destination, "Next stop"),
    fromPoint: coord(origin),
    toPoint: coord(destination),
    departure,
    arrival,
    duration,
    platformFrom: platform(origin),
    platformTo: platform(destination),
    headsign,
    tripId: String(first(transportation.id, transportation.tripCode, leg.id) || ""),
    intermediateStops,
    instructions: [],
    departureDelay: 0,
    arrivalDelay: 0,
    realtime: Boolean(origin.departureTimeEstimated || destination.arrivalTimeEstimated || leg.isRealtimeControlled),
    geometry,
  };
}

function normalizeJourney(journey, index) {
  const legs = (Array.isArray(journey?.legs) ? journey.legs : []).map(normalizeLeg).filter((leg) => leg.departure && leg.arrival);
  if (!legs.length) return null;
  const departure = legs[0].departure;
  const arrival = legs[legs.length - 1].arrival;
  const departureDate = new Date(departure);
  const arrivalDate = new Date(arrival);
  if (Number.isNaN(departureDate.getTime()) || Number.isNaN(arrivalDate.getTime()) || arrivalDate <= departureDate) return null;
  const transitLegs = legs.filter((leg) => leg.mode !== "WALK");
  const geometry = [];
  for (const leg of legs) {
    const points = leg.geometry?.length ? leg.geometry : [leg.fromPoint, leg.toPoint].filter(Boolean);
    points.forEach((point, pointIndex) => {
      const previous = geometry[geometry.length - 1];
      if (pointIndex === 0 && previous && previous[0] === point[0] && previous[1] === point[1]) return;
      geometry.push(point);
    });
  }
  return {
    id: String(journey.id || `vmv-${index}-${departureDate.getTime()}`),
    departure,
    arrival,
    duration: Math.max(1, Math.round((arrivalDate - departureDate) / 60000)),
    description: legs.map((leg) => leg.title).filter((value, i, all) => value !== all[i - 1]).join(" → "),
    transfers: Math.max(0, transitLegs.length - 1),
    realtime: legs.some((leg) => leg.realtime),
    geometry,
    segments: legs,
    source: "vmv",
    provider: "VMV / MV FÄHRT GUT",
  };
}

function localDateParts(date) {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}${parts.month}${parts.day}`, time: `${parts.hour}${parts.minute}` };
}

async function vmvPlan(request) {
  const incoming = new URL(request.url);
  const fromLat = Number(incoming.searchParams.get("fromLat"));
  const fromLon = Number(incoming.searchParams.get("fromLon"));
  const toLat = Number(incoming.searchParams.get("toLat"));
  const toLon = Number(incoming.searchParams.get("toLon"));
  const target = new Date(incoming.searchParams.get("time") || "");
  if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite) || Number.isNaN(target.getTime())) return json({ error: "invalid_request" }, 400);

  const searchStart = new Date(target.getTime() - 60 * 60 * 1000);
  const parts = localDateParts(searchStart);
  const params = new URLSearchParams({
    outputFormat: "rapidJSON",
    coordOutputFormat: "WGS84[DD.ddddd]",
    coordListOutputFormat: "list",
    locationServerActive: "1",
    useRealtime: "1",
    language: "de",
    type_origin: "coord",
    name_origin: `${fromLon.toFixed(6)}:${fromLat.toFixed(6)}:WGS84`,
    type_destination: "coord",
    name_destination: `${toLon.toFixed(6)}:${toLat.toFixed(6)}:WGS84`,
    itdTripDateTimeDepArr: "dep",
    itdDate: parts.date,
    itdTime: parts.time,
    calcNumberOfTrips: "12",
    sessionID: "0",
    requestID: "0",
    inclMOT_11: "on",
  });

  const efaUrl = `${VMV_BASE}XML_TRIP_REQUEST2?${params.toString()}`;
  const response = await fetch(efaUrl, {
    headers: { Accept: "application/json", "User-Agent": "Meet-Schwerin/0.8 (+https://github.com/Nexar69/NVS-meetup-planner)" },
    cf: { cacheTtl: 20, cacheEverything: true },
  });
  if (!response.ok) return json({ error: "vmv_http", status: response.status }, 502);
  const data = await response.json().catch(() => null);
  if (!data) return json({ error: "vmv_bad_json" }, 502);
  const journeys = Array.isArray(data.journeys) ? data.journeys : Array.isArray(data?.trips) ? data.trips : [];
  const routes = journeys.map(normalizeJourney).filter(Boolean);
  if (!routes.length) return json({ error: "vmv_no_routes", rawVersion: data.version || null }, 502);
  return json({ routes, provider: "VMV / MV FÄHRT GUT", rawVersion: data.version || null }, 200, { "cache-control": "public, max-age=15" });
}

async function createPlan(request, env) {
  if (!isAllowedWriteOrigin(request, env)) return json({ error: "origin_not_allowed" }, 403, corsHeaders(request, env));
  const text = await request.text();
  if (text.length > 16000) return json({ error: "plan_too_large" }, 413, corsHeaders(request, env));
  let raw;
  try { raw = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400, corsHeaders(request, env)); }
  const plan = validatePlan(raw);
  if (!plan) return json({ error: "invalid_plan" }, 400, corsHeaders(request, env));
  const ttl = Math.max(3600, Math.min(Number(env.PLAN_TTL_SECONDS) || DEFAULT_TTL, 7 * 24 * 60 * 60));
  let id = randomId();
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await env.PLANS.get(`p:${id}`))) break;
    id = randomId();
  }
  await env.PLANS.put(`p:${id}`, JSON.stringify(plan), { expirationTtl: ttl });
  const origin = new URL(request.url).origin;
  return json({ id, expiresIn: ttl, url: `${origin}/p/${id}` }, 201, corsHeaders(request, env));
}

async function getPlan(id, env) {
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12}$/.test(id)) return null;
  const text = await env.PLANS.get(`p:${id}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function sharedPage(request, env, id) {
  const plan = await getPlan(id, env);
  if (!plan) return new Response("This shared meetup has expired or does not exist.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  const url = new URL(request.url);
  const rawFocus = Number(url.searchParams.get("me"));
  const focus = Number.isInteger(rawFocus) && rawFocus >= 1 && rawFocus <= plan.members.length ? rawFocus - 1 : -1;
  const sharedPlan = { ...plan, view: focus >= 0 ? "person" : "group", focus };
  const appUrl = env.APP_URL || DEFAULT_APP_URL;
  const indexResponse = await fetch(appUrl, { cf: { cacheTtl: 30 } });
  if (!indexResponse.ok) return new Response("Meet Schwerin is temporarily unavailable.", { status: 502 });
  let html = await indexResponse.text();
  const injected = `<script>window.__NVS_SHORT_PLAN__=${JSON.stringify(sharedPlan).replace(/</g, "\\u003c")};window.__NVS_SHORT_FOCUS__=${focus};window.__NVS_BACKEND_URL__=${JSON.stringify(url.origin)};window.__NVS_APP_URL__=${JSON.stringify(appUrl)};<\/script><base href="/">`;
  html = html.replace("<head>", `<head>${injected}`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function proxyAsset(request, env) {
  const url = new URL(request.url);
  const appBase = new URL(env.APP_URL || DEFAULT_APP_URL);
  const path = url.pathname.replace(/^\/+/, "");
  if (!path || path.startsWith("api/") || path.startsWith("p/")) return Response.redirect(appBase.toString(), 302);
  const target = new URL(path, appBase);
  const response = await fetch(target.toString(), { cf: { cacheTtl: 300 } });
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", "*");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) return new Response(null, { status: 204, headers: corsHeaders(request, env) });

    if (url.pathname === "/api/health") return json({ ok: true, service: "meet-schwerin-v0.8", vmv: VMV_BASE });
    if (url.pathname === "/api/vmv/plan" && request.method === "GET") {
      const response = await vmvPlan(request);
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders(request, env)).forEach(([key, value]) => headers.set(key, value));
      return new Response(response.body, { status: response.status, headers });
    }
    if (url.pathname === "/api/plans" && request.method === "POST") return createPlan(request, env);
    if (url.pathname.startsWith("/api/plans/") && request.method === "GET") {
      const plan = await getPlan(url.pathname.split("/").pop(), env);
      return plan ? json({ plan }, 200, corsHeaders(request, env)) : json({ error: "not_found" }, 404, corsHeaders(request, env));
    }
    if (url.pathname.startsWith("/p/") && request.method === "GET") return sharedPage(request, env, url.pathname.split("/")[2] || "");
    if (request.method === "GET") return proxyAsset(request, env);
    return json({ error: "not_found" }, 404);
  },
};
