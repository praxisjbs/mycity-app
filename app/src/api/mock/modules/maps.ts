import maps from "@mycity/contract/schemas/maps.js";
import type { Place, PlaceView } from "@mycity/contract/contract.gen.ts";
import { fold, invalid, ok, route } from "../core";

/**
 * Maps and addresses on the mock (packages/contract/schemas/maps.js, docs/guides/addresses.md):
 * a short list of invented Lagos places and Nigerian cities. The search matches each word of the
 * text anywhere in the line, at most six, of the kinds the field's level offers; a pin names the
 * nearest place and keeps the point tapped. Nothing is asked of a provider, and there are no
 * tiles: the map draws its points on a blank ground.
 *
 * The mock signs nothing: its tokens are our API's shape with "mock" for a signature, read back
 * here by the contract's own reader (the browser checks the shape only), and the mock never ships
 * (F12 to F14). The other mock modules keep an address through `placeOf()` below.
 */
type Kind = Place["kind"];
type Level = "address" | "area" | "city";
const STREETS: Array<[string, number, number, Kind]> = [
  // The demonstration offices (mock worksites.ts), so their addresses are found too.
  ["4 Aromire Road, Ikoyi, Lagos", 6.452, 3.435, "building"],
  ["21 Herbert Macaulay Way, Yaba, Lagos", 6.5095, 3.379, "building"],
  ["7 Admiralty Way, Lekki Phase 1, Lagos", 6.447, 3.472, "building"],
  ["12 Admiralty Way, Lekki Phase 1, Lagos", 6.4321, 3.4219, "building"],
  ["Admiralty Road, Lekki Phase 1, Lagos", 6.4338, 3.4255, "street"],
  ["Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", 6.6142, 3.3578, "landmark"],
  ["Oba Akran Avenue, Ikeja, Lagos", 6.6018, 3.3515, "street"],
  ["Creek Road, Apapa, Lagos", 6.4474, 3.3595, "street"],
  ["Landmark Centre, Water Corporation Drive, Victoria Island, Lagos", 6.4229, 3.4501, "landmark"],
  ["Eko Convention Centre, Victoria Island, Lagos", 6.4253, 3.4074, "landmark"],
  ["Herbert Macaulay Way, Yaba, Lagos", 6.5095, 3.379, "street"],
  ["Allen Avenue, Ikeja, Lagos", 6.6005, 3.3545, "street"],
  ["Bourdillon Road, Ikoyi, Lagos", 6.4521, 3.4339, "street"],
  ["Lekki Phase 1, Lagos", 6.4478, 3.4723, "area"],
  ["Ikeja, Lagos", 6.6059, 3.3491, "area"],
];
const CITIES: Array<[string, number, number]> = [
  ["Lagos, Nigeria", 6.4541, 3.3947],
  ["Abuja, Nigeria", 9.0765, 7.3986],
  ["Enugu, Nigeria", 6.4584, 7.5464],
  ["Port Harcourt, Nigeria", 4.8156, 7.0498],
  ["Ibadan, Nigeria", 7.3775, 3.947],
  ["Kano, Nigeria", 12.0022, 8.592],
];

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

interface Summary {
  source: "search" | "pin" | "device" | "typed";
  formatted: string | null;
  lat: number | null;
  lon: number | null;
  kind: Kind;
  verified: boolean;
  pending: boolean;
  accuracy_m?: number | null;
}

/** A token in our API's shape, with "mock" for its signature. */
export function mockToken(p: Summary): string {
  const body = { s: p.source, f: p.formatted, la: p.lat, lo: p.lon, a: p.accuracy_m ?? null, k: p.kind, v: p.verified, p: p.pending };
  return `p1.${toBase64Url(JSON.stringify(body))}.mock`;
}

const placeOfRow = ([formatted, lat, lon, kind]: [string, number, number, Kind], i: number, prefix: string): Place => ({
  place_id: `${prefix}-${i}`,
  formatted,
  lat,
  lon,
  kind,
  token: mockToken({ source: "search", formatted, lat, lon, kind, verified: true, pending: false }),
});

const PLACES: Place[] = STREETS.map((row, i) => placeOfRow(row, i, "street"));
const CITY_PLACES: Place[] = CITIES.map(([f, lat, lon], i) => placeOfRow([f, lat, lon, "city"], i, "city"));

const offered = (level: Level) => (level === "city" ? CITY_PLACES : PLACES.filter((p) => level === "area" || p.kind !== "area"));
const levelOf = (v: unknown): Level => (v === "area" || v === "city" ? v : "address");

route("GET /api/v1/maps/search", (req) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return invalid({ "query.q": ["Too short"] });
  const words = fold(q).split(/[\s,]+/).filter(Boolean);
  return ok({ places: offered(levelOf(req.query.level)).filter((p) => words.every((w) => fold(p.formatted).includes(w))).slice(0, 6) });
});

/** Metres between two points, near enough for "is it this place". */
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111_320, (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180));

route("GET /api/v1/maps/pin", (req) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!req.query.lat || !req.query.lon || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return invalid({ "query.lat": ["Not a coordinate"] });
  const level = levelOf(req.query.level);
  const near = [...offered(level)].sort((a, b) => metres(a, { lat, lon }) - metres(b, { lat, lon }))[0]!;
  const formatted = level === "city" || metres(near, { lat, lon }) <= 300 ? near.formatted : `Near ${near.formatted}`;
  const at = level === "city" ? { lat: near.lat, lon: near.lon } : { lat, lon };
  return ok({ place_id: `pin-${lat},${lon}`, formatted, ...at, kind: near.kind, token: mockToken({ source: "pin", formatted, ...at, kind: near.kind, verified: true, pending: false }) });
});

/** An address as a form sends it (the contract's PlaceInput). */
export interface PlaceBody {
  token?: string;
  device?: { lat: number; lon: number; accuracy_m: number };
  details?: string | null;
}

/** What the mock keeps for a record's address: its readable line, and the place an edit form reads. */
export interface KeptPlace {
  line: string;
  view: PlaceView;
}

const fixed = (n: number) => n.toFixed(5);

/**
 * An address the mock keeps, or null when it is not one: a token in our shape, or the device's
 * location, as the API takes it. The line is the details first, then the address.
 */
export function placeOf(body: unknown): KeptPlace | null {
  if (!body || typeof body !== "object") return null;
  const b = body as PlaceBody;
  const details = typeof b.details === "string" && b.details.trim() ? b.details.trim().slice(0, 120) : null;
  let s: Summary | null = null;
  if (b.device && !b.token) {
    s = { source: "device", formatted: null, lat: b.device.lat, lon: b.device.lon, accuracy_m: b.device.accuracy_m, kind: "unknown", verified: false, pending: true };
  } else if (b.token && !b.device) {
    s = maps.readPlaceToken(b.token) as Summary | null;
  }
  if (!s) return null;
  const address = s.formatted ?? (s.lat !== null && s.lon !== null ? `Near ${fixed(s.lat)}, ${fixed(s.lon)}` : "");
  const line = [details, address].filter(Boolean).join(", ");
  return {
    line,
    view: { token: b.token ?? mockToken(s), formatted: s.formatted, details, lat: s.lat, lon: s.lon, source: s.source, kind: s.kind, verified: s.verified, pending: s.pending },
  };
}

/** An address typed before addresses were picked, as the backfill keeps one: typed and unverified. */
export function typedPlace(line: string | null | undefined, point?: { lat: number; lon: number } | null): KeptPlace | null {
  if (!line) return null;
  const s: Summary = { source: "typed", formatted: line, lat: point?.lat ?? null, lon: point?.lon ?? null, kind: "unknown", verified: false, pending: false };
  return { line, view: { token: mockToken(s), formatted: line, details: null, lat: s.lat, lon: s.lon, source: "typed", kind: "unknown", verified: false, pending: false } };
}

/** A picked place for seed data: one of the mock's own, as the search hands it out. */
export function pickedPlace(formatted: string, details: string | null = null): KeptPlace {
  const found = [...PLACES, ...CITY_PLACES].find((p) => p.formatted === formatted);
  const s: Summary = found
    ? { source: "search", formatted: found.formatted, lat: found.lat, lon: found.lon, kind: found.kind, verified: true, pending: false }
    : { source: "search", formatted, lat: 6.4541, lon: 3.3947, kind: "unknown", verified: true, pending: false };
  return { line: [details, formatted].filter(Boolean).join(", "), view: { token: mockToken(s), formatted, details, lat: s.lat, lon: s.lon, source: "search", kind: s.kind, verified: true, pending: false } };
}

/** The 422 the API sends for an address that is not a pick, on `field`. */
export const pickAnAddress = (field: string) => invalid({ [field]: ["Pick an address"] });
