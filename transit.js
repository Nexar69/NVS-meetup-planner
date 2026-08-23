(() => {
  const API_BASE = "https://api.transitous.org/api/v6/plan";
  const REQUEST_TIMEOUT_MS = 14_000;
  const CACHE_TTL_MS = 2 * 60_000;

  // Built-in Schwerin presets. Search/GPS locations can also be registered
  // at runtime without changing the route-matching code.
  const LOCATIONS = {
    "Lankow-Siedlung": {
      label: "Lankow-Siedlung",
      lat: 53.64883,
      lon: 11.36256,
    },
    "Hegelstraße": {
      label: "Hegelstraße",
      lat: 53.58713,
      lon: 11.47109,
    },
    "Dreescher Markt": {
      label: "Dreescher Markt",
      lat: 53.60333,
      lon: 11.43347,
    },
    Marienplatz: {
      label: "Marienplatz",
      lat: 53.62878,
      lon: 11.41065,
    },
    Hauptbahnhof: {
      label: "Hauptbahnhof",
      lat: 53.6342,
      lon: 11.4089,
    },
    "Schlosspark-Center": {
      label: "Schlosspark-Center",
      lat: 53.62824,
      lon: 11.40874,
    },
  };

  const routeCache = new Map();

  function registerLocation(key, location) {
    const lat = Number(location?.lat);
    const lon = Number(location?.lon ?? location?.lng);
    if (!key || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("INVALID_LOCATION");
    }

    LOCATIONS[key] = {
      label: String(location.label || key),
      lat,
      lon,
      custom: true,
      source: location.source || "custom",
    };
    routeCache.clear();
    return key;
  }

  function addMinutes(date, value) {
    return new Date(date.getTime() + value * 60_000);
  }

  function toIsoDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      const ms = value < 1_000_000_000_000 ? value * 1000 : value;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string" && value) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  function firstDate(...values) {
    for (const value of values) {
      const date = toIsoDate(value);
      if (date) return date;
    }
    return null;
  }

  function firstText(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return "";
  }

  function valueAt(obj, paths) {
    for (const path of paths) {
      let current = obj;
      let found = true;
      for (const key of path.split(".")) {
        if (current == null || !(key in current)) {
          found = false;
          break;
        }
        current = current[key];
      }
      if (found && current != null) return current;
    }
    return undefined;
  }

  function legDeparture(leg) {
    return firstDate(
      valueAt(leg, ["startTime"]),
      valueAt(leg, ["scheduledStartTime"]),
      valueAt(leg, ["departure"]),
      valueAt(leg, ["scheduledDeparture"]),
      valueAt(leg, ["from.departure"]),
      valueAt(leg, ["from.scheduledDeparture"]),
    );
  }

  function legArrival(leg) {
    return firstDate(
      valueAt(leg, ["endTime"]),
      valueAt(leg, ["scheduledEndTime"]),
      valueAt(leg, ["arrival"]),
      valueAt(leg, ["scheduledArrival"]),
      valueAt(leg, ["to.arrival"]),
      valueAt(leg, ["to.scheduledArrival"]),
    );
  }

  function itineraryTimes(itinerary) {
    const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
    const firstLeg = legs[0] || {};
    const lastLeg = legs[legs.length - 1] || {};

    const departure = firstDate(
      itinerary.startTime,
      itinerary.scheduledStartTime,
      itinerary.departure,
      itinerary.scheduledDeparture,
    ) || legDeparture(firstLeg);

    const arrival = firstDate(
      itinerary.endTime,
      itinerary.scheduledEndTime,
      itinerary.arrival,
      itinerary.scheduledArrival,
    ) || legArrival(lastLeg);

    return { departure, arrival };
  }

  function routeName(leg) {
    return firstText(
      leg.routeShortName,
      valueAt(leg, ["route.shortName"]),
      valueAt(leg, ["route.name"]),
      leg.tripShortName,
    );
  }

  function modeLabel(mode) {
    const normalized = String(mode || "").toUpperCase();
    const labels = {
      WALK: "Walk",
      TRAM: "Tram",
      BUS: "Bus",
      RAIL: "Train",
      SUBURBAN: "S-Bahn",
      SUBWAY: "U-Bahn",
      FERRY: "Ferry",
      BICYCLE: "Bike",
    };
    return labels[normalized] || (normalized ? normalized[0] + normalized.slice(1).toLowerCase() : "Transit");
  }

  function legDurationMinutes(leg) {
    if (typeof leg.duration === "number") {
      const seconds = leg.duration > 100_000 ? leg.duration / 1000 : leg.duration;
      return Math.max(1, Math.round(seconds / 60));
    }
    const departure = legDeparture(leg);
    const arrival = legArrival(leg);
    if (!departure || !arrival) return null;
    return Math.max(1, Math.round((arrival - departure) / 60_000));
  }

  function describeLeg(leg) {
    const mode = String(leg.mode || "").toUpperCase();
    const minutes = legDurationMinutes(leg);

    if (mode === "WALK") {
      return minutes ? `Walk ${minutes} min` : "Walk";
    }

    const line = routeName(leg);
    const label = modeLabel(mode);
    return line ? `${label} ${line}` : label;
  }

  function placeName(value, fallback = "") {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return fallback;

    return firstText(
      value.name,
      value.displayName,
      value.label,
      value.stopName,
      valueAt(value, ["stop.name"]),
      valueAt(value, ["stop.displayName"]),
      valueAt(value, ["station.name"]),
      fallback,
    );
  }

  function platformName(value) {
    if (!value || typeof value !== "object") return "";
    return firstText(
      value.track,
      value.platform,
      value.platformCode,
      valueAt(value, ["stop.platformCode"]),
      valueAt(value, ["stop.platform"]),
      valueAt(value, ["stop.track"]),
    );
  }

  function delayMinutes(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds === 0) return 0;
    return Math.round(seconds / 60);
  }

  function normalizeSegment(leg, index) {
    const mode = String(leg.mode || "").toUpperCase();
    const fromObject = valueAt(leg, ["from"]);
    const toObject = valueAt(leg, ["to"]);
    const departure = legDeparture(leg);
    const arrival = legArrival(leg);
    const line = routeName(leg);
    const modeText = modeLabel(mode);
    const headsign = firstText(
      leg.headsign,
      leg.tripHeadsign,
      valueAt(leg, ["trip.headsign"]),
      valueAt(leg, ["routeLongName"]),
    );

    return {
      index,
      mode,
      modeLabel: modeText,
      line,
      title: mode === "WALK" ? "Walk" : line ? `${modeText} ${line}` : modeText,
      from: placeName(fromObject, firstText(leg.fromName, leg.startName)),
      to: placeName(toObject, firstText(leg.toName, leg.endName)),
      departure,
      arrival,
      duration: legDurationMinutes(leg),
      platformFrom: platformName(fromObject),
      platformTo: platformName(toObject),
      headsign,
      departureDelay: delayMinutes(leg.departureDelay),
      arrivalDelay: delayMinutes(leg.arrivalDelay),
      realtime: leg.realTime === true || leg.realtime === true ||
        delayMinutes(leg.departureDelay) !== 0 || delayMinutes(leg.arrivalDelay) !== 0,
    };
  }

  // MOTIS detailed legs encode geometry as a Google encoded polyline at
  // precision 6. Keeping this decoder here avoids another routing dependency.
  function decodePolyline(encoded, precision = 6) {
    if (typeof encoded !== "string" || !encoded) return [];

    const factor = 10 ** precision;
    const coordinates = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
      let result = 0;
      let shift = 0;
      let byte;

      do {
        if (index >= encoded.length) return coordinates;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      latitude += result & 1 ? ~(result >> 1) : result >> 1;
      result = 0;
      shift = 0;

      do {
        if (index >= encoded.length) return coordinates;
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      longitude += result & 1 ? ~(result >> 1) : result >> 1;
      coordinates.push([latitude / factor, longitude / factor]);
    }

    return coordinates;
  }

  function legGeometryPoints(leg) {
    const raw =
      valueAt(leg, ["legGeometry.points"]) ||
      valueAt(leg, ["geometry.points"]) ||
      valueAt(leg, ["legGeometry"]) ||
      valueAt(leg, ["geometry"]);

    if (Array.isArray(raw)) {
      return raw
        .map((point) => {
          if (Array.isArray(point) && point.length >= 2) {
            return [Number(point[0]), Number(point[1])];
          }
          if (point && typeof point === "object") {
            const lat = Number(point.lat ?? point.latitude);
            const lon = Number(point.lon ?? point.lng ?? point.longitude);
            return [lat, lon];
          }
          return null;
        })
        .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
    }

    return decodePolyline(raw, 6);
  }

  function itineraryGeometry(legs) {
    const combined = [];

    for (const leg of legs) {
      const points = legGeometryPoints(leg);
      if (!points.length) continue;

      points.forEach((point, index) => {
        const previous = combined[combined.length - 1];
        if (index === 0 && previous && previous[0] === point[0] && previous[1] === point[1]) return;
        combined.push(point);
      });
    }

    return combined;
  }

  function hasNonZeroDelay(value) {
    const delay = Number(value);
    return Number.isFinite(delay) && delay !== 0;
  }

  function normalizeItinerary(itinerary, index, origin, destination) {
    const legs = Array.isArray(itinerary.legs) ? itinerary.legs : [];
    const { departure, arrival } = itineraryTimes(itinerary);
    if (!departure || !arrival || arrival <= departure) return null;

    const seconds = Number(itinerary.duration);
    const duration = Number.isFinite(seconds) && seconds > 0
      ? Math.max(1, Math.round((seconds > 100_000 ? seconds / 1000 : seconds) / 60))
      : Math.max(1, Math.round((arrival - departure) / 60_000));

    const descriptionParts = legs
      .map(describeLeg)
      .filter(Boolean)
      .filter((part, partIndex, parts) => part !== parts[partIndex - 1]);

    const transitLegs = legs.filter((leg) => String(leg.mode || "").toUpperCase() !== "WALK");
    const transfersRaw = Number(itinerary.transfers);
    const transfers = Number.isFinite(transfersRaw)
      ? Math.max(0, transfersRaw)
      : Math.max(0, transitLegs.length - 1);

    const realtime = legs.some(
      (leg) =>
        leg.realTime === true ||
        leg.realtime === true ||
        hasNonZeroDelay(leg.departureDelay) ||
        hasNonZeroDelay(leg.arrivalDelay),
    );

    return {
      id: itinerary.id || `${origin}-${destination}-live-${index}-${departure.getTime()}`,
      origin,
      destination,
      departure,
      arrival,
      duration,
      description: descriptionParts.join(" → ") || "Public transport",
      transfers,
      realtime,
      geometry: itineraryGeometry(legs),
      segments: legs.map(normalizeSegment),
      source: "live",
    };
  }

  function dedupeAndSort(routes) {
    const seen = new Set();
    return routes
      .sort((a, b) => a.departure - b.departure || a.arrival - b.arrival)
      .filter((route) => {
        const key = `${route.departure.getTime()}-${route.arrival.getTime()}-${route.description}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function buildRequestUrl(originKey, destinationKey, target) {
    const origin = LOCATIONS[originKey];
    const destination = LOCATIONS[destinationKey];
    if (!origin || !destination) throw new Error("UNKNOWN_LOCATION");

    const searchStart = addMinutes(target, -60);
    const params = new URLSearchParams({
      fromPlace: `${origin.lat},${origin.lon}`,
      toPlace: `${destination.lat},${destination.lon}`,
      time: searchStart.toISOString(),
      arriveBy: "false",
      timetableView: "true",
      searchWindow: "7200",
      numItineraries: "10",
      maxItineraries: "16",
      maxTransfers: "3",
      maxTravelTime: "90",
      transitModes: "TRANSIT",
      directModes: "WALK",
      preTransitModes: "WALK",
      postTransitModes: "WALK",
      maxPreTransitTime: "1200",
      maxPostTransitTime: "1200",
      maxDirectTime: "3600",
      fastestDirectFactor: "4",
      detailedLegs: "true",
      detailedTransfers: "true",
      realtimeMode: "REALTIME",
      language: "de",
      timeout: "10",
    });

    return `${API_BASE}?${params.toString()}`;
  }

  function cacheKey(origin, destination, target) {
    const bucket = Math.floor(target.getTime() / 300_000);
    return `${origin}|${destination}|${bucket}`;
  }

  function reviveRoute(route) {
    return {
      ...route,
      departure: new Date(route.departure),
      arrival: new Date(route.arrival),
      segments: Array.isArray(route.segments)
        ? route.segments.map((segment) => ({
            ...segment,
            departure: segment.departure ? new Date(segment.departure) : null,
            arrival: segment.arrival ? new Date(segment.arrival) : null,
          }))
        : [],
    };
  }

  function serializeRoute(route) {
    return {
      ...route,
      departure: route.departure.toISOString(),
      arrival: route.arrival.toISOString(),
      segments: Array.isArray(route.segments)
        ? route.segments.map((segment) => ({
            ...segment,
            departure: segment.departure?.toISOString?.() || null,
            arrival: segment.arrival?.toISOString?.() || null,
          }))
        : [],
    };
  }

  async function fetchRoutes(origin, destination, target) {
    if (origin === destination) {
      const departure = addMinutes(target, -5);
      const point = LOCATIONS[origin];
      return [{
        id: `${origin}-same-place`,
        origin,
        destination,
        departure,
        arrival: target,
        duration: 5,
        description: "Short walk",
        transfers: 0,
        realtime: false,
        geometry: point ? [[point.lat, point.lon], [point.lat, point.lon]] : [],
        segments: [{
          index: 0,
          mode: "WALK",
          modeLabel: "Walk",
          line: "",
          title: "Walk",
          from: LOCATIONS[origin]?.label || origin,
          to: LOCATIONS[destination]?.label || destination,
          departure,
          arrival: target,
          duration: 5,
          platformFrom: "",
          platformTo: "",
          headsign: "",
          departureDelay: 0,
          arrivalDelay: 0,
          realtime: false,
        }],
        source: "local",
      }];
    }

    const key = cacheKey(origin, destination, target);
    const cached = routeCache.get(key);
    if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
      return cached.routes.map(reviveRoute);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(buildRequestUrl(origin, destination, target), {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("API_TIMEOUT");
      throw new Error("API_NETWORK");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) throw new Error(`API_HTTP_${response.status}`);

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("API_BAD_JSON");
    }

    const itineraries = Array.isArray(data?.itineraries)
      ? data.itineraries
      : Array.isArray(data?.plan?.itineraries)
        ? data.plan.itineraries
        : [];

    const routes = dedupeAndSort(
      itineraries
        .map((itinerary, index) => normalizeItinerary(itinerary, index, origin, destination))
        .filter(Boolean),
    );

    routeCache.set(key, {
      createdAt: Date.now(),
      routes: routes.map(serializeRoute),
    });

    return routes;
  }

  window.NVSTransit = Object.freeze({
    API_BASE,
    LOCATIONS,
    registerLocation,
    fetchRoutes,
  });
})();
