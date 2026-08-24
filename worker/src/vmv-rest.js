const VMV_REST_BASE = "https://v5.vmv.transport.rest";

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const appOrigin = new URL(env.APP_URL || "https://nexar69.github.io/NVS-meetup-planner/").origin;
  const allowed = origin === appOrigin || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return allowed ? {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  } : {};
}

function asIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function point(location) {
  const lat = Number(location?.latitude ?? location?.location?.latitude);
  const lon = Number(location?.longitude ?? location?.location?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

function modeFor(leg) {
  if (leg?.walking === true) return "WALK";
  const product = String(leg?.line?.product || "").toLowerCase();
  const mode = String(leg?.line?.mode || "").toLowerCase();
  const text = `${product} ${mode}`;
  if (text.includes("tram")) return "TRAM";
  if (text.includes("bus")) return "BUS";
  if (text.includes("suburban")) return "SUBURBAN";
  if (text.includes("subway")) return "SUBWAY";
  if (text.includes("ferry")) return "FERRY";
  if (text.includes("taxi")) return "TAXI";
  return "RAIL";
}

function modeLabel(mode) {
  return {
    WALK: "Walk",
    TRAM: "Tram",
    BUS: "Bus",
    SUBURBAN: "S-Bahn",
    SUBWAY: "U-Bahn",
    FERRY: "Ferry",
    TAXI: "Taxi",
    RAIL: "Train",
  }[mode] || "Transit";
}

function geometryCoordinates(value) {
  if (!value) return [];
  if (value.type === "FeatureCollection" && Array.isArray(value.features)) {
    return value.features.flatMap((feature) => geometryCoordinates(feature));
  }
  if (value.type === "Feature") return geometryCoordinates(value.geometry);
  if (value.type === "LineString" && Array.isArray(value.coordinates)) {
    return value.coordinates
      .map((coord) => Array.isArray(coord) && coord.length >= 2 ? [Number(coord[1]), Number(coord[0])] : null)
      .filter((coord) => coord && Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  }
  if (value.type === "MultiLineString" && Array.isArray(value.coordinates)) {
    return value.coordinates.flatMap((line) => geometryCoordinates({ type: "LineString", coordinates: line }));
  }
  if (Array.isArray(value)) {
    return value
      .map((coord) => Array.isArray(coord) && coord.length >= 2 ? [Number(coord[1]), Number(coord[0])] : null)
      .filter((coord) => coord && Number.isFinite(coord[0]) && Number.isFinite(coord[1]));
  }
  return [];
}

function remarkText(remark) {
  return String(remark?.summary || remark?.text || remark?.type || "").trim();
}

function normalizeStopover(stopover) {
  const stop = stopover?.stop || stopover?.station || stopover;
  const actualTrack = String(stopover?.departurePlatform || stopover?.arrivalPlatform || "");
  const plannedTrack = String(stopover?.plannedDeparturePlatform || stopover?.plannedArrivalPlatform || "");
  return {
    name: String(stop?.name || stopover?.name || "Stop"),
    arrival: asIso(stopover?.arrival || stopover?.plannedArrival),
    departure: asIso(stopover?.departure || stopover?.plannedDeparture),
    track: actualTrack || plannedTrack,
    plannedTrack,
    point: point(stop),
    cancelled: Boolean(stopover?.cancelled),
  };
}

function normalizeLeg(leg, index) {
  const departure = asIso(leg?.departure || leg?.plannedDeparture);
  const arrival = asIso(leg?.arrival || leg?.plannedArrival);
  if (!departure || !arrival || new Date(arrival) <= new Date(departure)) return null;

  const mode = modeFor(leg);
  const label = modeLabel(mode);
  const line = mode === "WALK" ? "" : String(leg?.line?.name || leg?.line?.fahrtNr || leg?.line?.id || "").trim();
  const from = leg?.origin || {};
  const to = leg?.destination || {};
  const stopoversRaw = Array.isArray(leg?.stopovers) ? leg.stopovers : [];
  const stopovers = stopoversRaw.map(normalizeStopover).filter((stop) => stop?.name);
  const intermediateStops = stopovers.length > 2 ? stopovers.slice(1, -1) : [];
  const departureDelay = Number(leg?.departureDelay);
  const arrivalDelay = Number(leg?.arrivalDelay);
  const geometry = geometryCoordinates(leg?.polyline || leg?.geometry);
  const plannedPlatformFrom = String(leg?.plannedDeparturePlatform || "");
  const plannedPlatformTo = String(leg?.plannedArrivalPlatform || "");
  const platformFrom = String(leg?.departurePlatform || plannedPlatformFrom || "");
  const platformTo = String(leg?.arrivalPlatform || plannedPlatformTo || "");
  const remarks = (Array.isArray(leg?.remarks) ? leg.remarks : []).map(remarkText).filter(Boolean).slice(0, 8);
  const cancelled = Boolean(leg?.cancelled || stopovers.some((stop) => stop.cancelled));
  const platformChanged = Boolean(plannedPlatformFrom && platformFrom && plannedPlatformFrom !== platformFrom);

  return {
    index,
    mode,
    modeLabel: label,
    line,
    title: mode === "WALK" ? "Walk" : `${label}${line ? ` ${line}` : ""}`,
    from: String(from?.name || from?.address || "Start"),
    to: String(to?.name || to?.address || "Next stop"),
    fromPoint: point(from),
    toPoint: point(to),
    departure,
    arrival,
    duration: Math.max(1, Math.round((new Date(arrival) - new Date(departure)) / 60000)),
    platformFrom,
    platformTo,
    plannedPlatformFrom,
    plannedPlatformTo,
    headsign: String(leg?.direction || ""),
    tripId: String(leg?.tripId || ""),
    intermediateStops,
    instructions: [],
    departureDelay: Number.isFinite(departureDelay) ? Math.round(departureDelay / 60) : 0,
    arrivalDelay: Number.isFinite(arrivalDelay) ? Math.round(arrivalDelay / 60) : 0,
    cancelled,
    remarks,
    realtime: Boolean(
      cancelled ||
      platformChanged ||
      (Number.isFinite(departureDelay) && departureDelay !== 0) ||
      (Number.isFinite(arrivalDelay) && arrivalDelay !== 0) ||
      (leg?.departure && leg?.plannedDeparture && leg.departure !== leg.plannedDeparture) ||
      (leg?.arrival && leg?.plannedArrival && leg.arrival !== leg.plannedArrival)
    ),
    geometry,
  };
}

function combineGeometry(segments) {
  const combined = [];
  for (const segment of segments) {
    const points = segment.geometry?.length >= 2
      ? segment.geometry
      : [segment.fromPoint, segment.toPoint].filter(Boolean);
    for (const pointValue of points) {
      const previous = combined[combined.length - 1];
      if (previous && previous[0] === pointValue[0] && previous[1] === pointValue[1]) continue;
      combined.push(pointValue);
    }
  }
  return combined;
}

function normalizeJourney(journey, index) {
  const segments = (Array.isArray(journey?.legs) ? journey.legs : [])
    .map(normalizeLeg)
    .filter(Boolean);
  if (!segments.length) return null;

  const departure = segments[0].departure;
  const arrival = segments[segments.length - 1].arrival;
  const transitSegments = segments.filter((segment) => segment.mode !== "WALK");

  return {
    id: String(journey?.refreshToken || journey?.cycle?.id || `vmv-rest-${index}-${Date.parse(departure)}`),
    departure,
    arrival,
    duration: Math.max(1, Math.round((new Date(arrival) - new Date(departure)) / 60000)),
    description: segments.map((segment) => segment.title).filter((value, i, all) => value !== all[i - 1]).join(" → "),
    transfers: Math.max(0, transitSegments.length - 1),
    realtime: segments.some((segment) => segment.realtime),
    disrupted: segments.some((segment) => segment.cancelled || Math.max(segment.departureDelay || 0, segment.arrivalDelay || 0) >= 5),
    geometry: combineGeometry(segments),
    segments,
    source: "vmv-rest",
    provider: "VMV",
  };
}

function requestUrl(fromLat, fromLon, toLat, toLon, target) {
  const searchStart = new Date(target.getTime() - 60 * 60 * 1000);
  const url = new URL(`${VMV_REST_BASE}/journeys`);
  url.searchParams.set("from.latitude", fromLat.toFixed(6));
  url.searchParams.set("from.longitude", fromLon.toFixed(6));
  url.searchParams.set("from.address", "Start");
  url.searchParams.set("to.latitude", toLat.toFixed(6));
  url.searchParams.set("to.longitude", toLon.toFixed(6));
  url.searchParams.set("to.address", "Meetup");
  url.searchParams.set("departure", searchStart.toISOString());
  url.searchParams.set("results", "12");
  url.searchParams.set("stopovers", "true");
  url.searchParams.set("polylines", "true");
  url.searchParams.set("remarks", "true");
  url.searchParams.set("language", "de");
  url.searchParams.set("pretty", "false");
  return url;
}

export async function vmvRestPlan(request, env) {
  const headers = corsHeaders(request, env);
  const incoming = new URL(request.url);
  const fromLat = Number(incoming.searchParams.get("fromLat"));
  const fromLon = Number(incoming.searchParams.get("fromLon"));
  const toLat = Number(incoming.searchParams.get("toLat"));
  const toLon = Number(incoming.searchParams.get("toLon"));
  const target = new Date(incoming.searchParams.get("time") || "");
  if (![fromLat, fromLon, toLat, toLon].every(Number.isFinite) || Number.isNaN(target.getTime())) {
    return json({ error: "vmv_rest_invalid_request" }, 400, headers);
  }

  let response;
  try {
    response = await fetch(requestUrl(fromLat, fromLon, toLat, toLon, target), {
      method: "GET",
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 15, cacheEverything: true },
    });
  } catch (error) {
    return json({ error: "vmv_rest_network", detail: String(error?.message || error) }, 502, headers);
  }

  if (!response.ok) {
    return json({ error: "vmv_rest_http", status: response.status }, 502, headers);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return json({ error: "vmv_rest_bad_json" }, 502, headers);
  }

  const routes = (Array.isArray(data?.journeys) ? data.journeys : [])
    .map(normalizeJourney)
    .filter(Boolean);
  if (!routes.length) {
    return json({ error: "vmv_rest_no_routes", upstreamKeys: Object.keys(data || {}).slice(0, 12) }, 502, headers);
  }

  return json({ routes, provider: "VMV", source: "vmv-rest" }, 200, {
    ...headers,
    "cache-control": "public, max-age=15",
    "x-meet-schwerin-routing": "vmv-rest",
  });
}
