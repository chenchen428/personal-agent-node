#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const command = args.shift();
const options = parseArgs(args);

if (!command || options.help || !["poi", "route"].includes(command)) {
  printHelp();
  process.exit(command && !options.help ? 1 : 0);
}

const request = command === "poi" ? buildPoiRequest(options) : buildRouteRequest(options);
const snapshot = options["dry-run"]
  ? {
      schemaVersion: 1,
      provider: "amap",
      operation: command,
      queriedAt: new Date().toISOString(),
      dryRun: true,
      request: request.publicRequest,
      result: null,
    }
  : await executeRequest(command, request, options);

if (options.output) {
  const target = path.resolve(String(options.output));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  operation: snapshot.operation,
  dryRun: Boolean(snapshot.dryRun),
  queriedAt: snapshot.queriedAt,
  output: options.output ? path.resolve(String(options.output)) : null,
  request: snapshot.request,
  count: snapshot.result?.count ?? snapshot.result?.alternatives?.length ?? null,
}, null, 2)}\n`);

function parseArgs(input) {
  const parsed = {};
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = input[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(values, name) {
  const value = String(values[name] || "").trim();
  if (!value) throw new Error(`Missing required option --${name}`);
  return value;
}

function buildPoiRequest(input) {
  const keywords = String(input.keywords || "").trim();
  const types = String(input.types || "").trim();
  if (!keywords && !types) throw new Error("POI query requires --keywords or --types");
  const city = required(input, "city");
  const params = new URLSearchParams({
    output: "JSON",
    offset: clampInteger(input.offset, 1, 25, 10),
    page: clampInteger(input.page, 1, 100, 1),
    extensions: input.extensions === "all" ? "all" : "base",
    city,
    citylimit: parseBoolean(input["city-limit"] ?? true) ? "true" : "false",
  });
  if (keywords) params.set("keywords", keywords);
  if (types) params.set("types", types);
  return {
    endpoint: "https://restapi.amap.com/v3/place/text",
    params,
    publicRequest: Object.fromEntries(params),
  };
}

function buildRouteRequest(input) {
  const mode = required(input, "mode");
  const endpoints = {
    walking: "https://restapi.amap.com/v3/direction/walking",
    transit: "https://restapi.amap.com/v3/direction/transit/integrated",
    driving: "https://restapi.amap.com/v3/direction/driving",
    bicycling: "https://restapi.amap.com/v4/direction/bicycling",
  };
  if (!endpoints[mode]) throw new Error("--mode must be walking, transit, driving, or bicycling");
  const origin = validateCoordinate(required(input, "origin"), "origin");
  const destination = validateCoordinate(required(input, "destination"), "destination");
  const params = new URLSearchParams({ origin, destination, output: "JSON" });
  if (mode === "transit") {
    params.set("city", required(input, "city"));
    if (input.cityd) params.set("cityd", String(input.cityd));
    if (input.strategy) params.set("strategy", String(input.strategy));
  }
  if (mode === "driving" && input.strategy) params.set("strategy", String(input.strategy));
  return {
    endpoint: endpoints[mode],
    params,
    mode,
    publicRequest: { mode, ...Object.fromEntries(params) },
  };
}

async function executeRequest(operation, requestData, input) {
  const keyFile = path.resolve(required(input, "key-file"));
  const key = fs.readFileSync(keyFile, "utf8").trim();
  if (!key) throw new Error("The AMap key file is empty; use --dry-run to inspect the request");
  const url = new URL(requestData.endpoint);
  for (const [name, value] of requestData.params) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  const timeoutMs = Number(clampInteger(input["timeout-ms"], 1_000, 60_000, 15_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`AMap request failed with HTTP ${response.status}`);
  const raw = await response.json();
  const ok = raw.status === "1" || Number(raw.errcode) === 0;
  if (!ok) throw new Error(`AMap request failed: ${raw.info || raw.errmsg || "unknown provider error"}`);
  return {
    schemaVersion: 1,
    provider: "amap",
    operation,
    queriedAt: new Date().toISOString(),
    request: requestData.publicRequest,
    result: operation === "poi" ? normalizePois(raw) : normalizeRoutes(raw, requestData.mode),
  };
}

function normalizePois(raw) {
  const pois = Array.isArray(raw.pois) ? raw.pois : [];
  return {
    count: Number(raw.count || pois.length),
    candidates: pois.map((poi) => ({
      id: clean(poi.id),
      name: clean(poi.name),
      address: clean(poi.address),
      location: clean(poi.location),
      type: clean(poi.type),
      typecode: clean(poi.typecode),
      cityname: clean(poi.cityname),
      adname: clean(poi.adname),
      businessArea: clean(poi.business_area),
      distanceMeters: numericOrNull(poi.distance),
    })),
  };
}

function normalizeRoutes(raw, mode) {
  const paths = mode === "transit"
    ? raw.route?.transits
    : mode === "bicycling"
      ? raw.data?.paths
      : raw.route?.paths;
  return {
    origin: clean(raw.route?.origin) || null,
    destination: clean(raw.route?.destination) || null,
    alternatives: (Array.isArray(paths) ? paths : []).slice(0, 3).map((route, index) => ({
      index,
      distanceMeters: numericOrNull(route.distance),
      durationSeconds: numericOrNull(route.duration),
      walkingDistanceMeters: numericOrNull(route.walking_distance),
      costYuan: numericOrNull(route.cost),
      transfers: mode === "transit" ? Math.max(0, (route.segments?.length || 1) - 1) : null,
      steps: normalizeSteps(route, mode),
    })),
  };
}

function normalizeSteps(route, mode) {
  if (mode === "transit") {
    return (route.segments || []).slice(0, 24).map((segment) => ({
      walking: clean(segment.walking?.distance) ? {
        distanceMeters: numericOrNull(segment.walking.distance),
        destination: clean(segment.walking.destination),
      } : null,
      busLines: (segment.bus?.buslines || []).map((line) => ({
        name: clean(line.name),
        departureStop: clean(line.departure_stop?.name),
        arrivalStop: clean(line.arrival_stop?.name),
        durationSeconds: numericOrNull(line.duration),
        viaStops: Array.isArray(line.via_stops) ? line.via_stops.length : 0,
      })),
    }));
  }
  return (route.steps || []).slice(0, 40).map((step) => ({
    instruction: clean(step.instruction),
    road: clean(step.road),
    distanceMeters: numericOrNull(step.distance),
    durationSeconds: numericOrNull(step.duration),
    action: clean(step.action),
  }));
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(", ");
  return String(value ?? "").trim() || null;
}

function numericOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validateCoordinate(value, name) {
  const match = /^(-?\d+(?:\.\d{1,6})?),(-?\d+(?:\.\d{1,6})?)$/.exec(value);
  if (!match) throw new Error(`--${name} must use longitude,latitude with at most 6 decimals`);
  const longitude = Number(match[1]);
  const latitude = Number(match[2]);
  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    throw new Error(`--${name} is outside valid coordinate bounds`);
  }
  return value;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number.parseInt(String(value || fallback), 10);
  return String(Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback)));
}

function parseBoolean(value) {
  return !["0", "false", "no"].includes(String(value).toLowerCase());
}

function printHelp() {
  process.stdout.write(`AMap travel query

Usage:
  query.mjs poi --keywords <text> [--types <codes>] [--city <name|adcode>] [--city-limit true] [--output <json>] [--dry-run]
  query.mjs route --mode <walking|transit|driving|bicycling> --origin <lon,lat> --destination <lon,lat> [--city <name|adcode>] [--cityd <name|adcode>] [--strategy <value>] [--output <json>] [--dry-run]

Live requests require --key-file <ignored-local-file>. The key and file path are never written to output.
`);
}
