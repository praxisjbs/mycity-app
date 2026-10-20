/**
 * Sample places for the Maps group's and the address fields' gallery pages and tests,
 * and the lookups they need, answered from this list instead of the API. Not exported
 * from the package; a screen's lookups go through the app's own client.
 *
 * A sample place carries a token in our API's shape (`p1.<payload>.<signature>`), with
 * "sample" for its signature: the gallery reads it back itself, and nothing checks it.
 */
import type { LatLon, Place, PlaceKind, Places, PlaceSummary, ResolveAddress, SearchPlaces } from "./geoapify";

/**
 * The tile the gallery draws with: one flat pixel, as a data URL, so a page of
 * maps asks the network for nothing. A screen's tiles come from our own proxy
 * (`TILES`), which the gallery has no server for.
 */
export const SAMPLE_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mN49OIZAAVgArHOP1vTAAAAAElFTkSuQmCC";

export const LEKKI: LatLon = { lat: 6.4321, lon: 3.4219 };
export const IKEJA: LatLon = { lat: 6.6018, lon: 3.3515 };

const toBase64Url = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromBase64Url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

/** A token for a sample place, in our API's shape. */
export function sampleToken(place: Partial<PlaceSummary> & { formatted: string | null }): string {
  const payload = {
    s: place.source ?? "search",
    f: place.formatted,
    la: place.lat ?? null,
    lo: place.lon ?? null,
    k: place.kind ?? "unknown",
    v: place.verified ?? place.source !== "typed",
    p: place.pending ?? false,
  };
  return `p1.${toBase64Url(JSON.stringify(payload))}.sample`;
}

/** What a sample token says; null for anything else. */
export function readSampleToken(token: string): PlaceSummary | null {
  const [v, payload] = token.split(".");
  if (v !== "p1" || !payload) return null;
  try {
    const p = JSON.parse(fromBase64Url(payload)) as { s: PlaceSummary["source"]; f: string | null; la: number | null; lo: number | null; k: PlaceKind; v: boolean; p: boolean };
    return { source: p.s, formatted: p.f, lat: p.la, lon: p.lo, kind: p.k, verified: p.v, pending: p.p };
  } catch {
    return null;
  }
}

const sample = (place_id: string, formatted: string, lat: number, lon: number, kind: PlaceKind): Place => ({
  place_id,
  formatted,
  lat,
  lon,
  kind,
  token: sampleToken({ formatted, lat, lon, kind }),
});

export const SAMPLE_PLACES: Place[] = [
  sample("p1", "12 Admiralty Way, Lekki Phase 1, Lagos", 6.4321, 3.4219, "building"),
  sample("p2", "Admiralty Road, Lekki Phase 1, Lagos", 6.4338, 3.4255, "street"),
  sample("p3", "Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", 6.6142, 3.3578, "landmark"),
  sample("p4", "Apapa Yard, Creek Road, Apapa, Lagos", 6.4474, 3.3595, "building"),
  sample("p5", "Lekki Phase 1, Lagos", 6.4478, 3.4723, "area"),
];

export const SAMPLE_CITIES: Place[] = [
  sample("c1", "Lagos, Nigeria", 6.4541, 3.3947, "city"),
  sample("c2", "Abuja, Nigeria", 9.0765, 7.3986, "city"),
  sample("c3", "Enugu, Nigeria", 6.4584, 7.5464, "city"),
  sample("c4", "Port Harcourt, Nigeria", 4.8156, 7.0498, "city"),
  sample("c5", "Ibadan, Nigeria", 7.3775, 3.947, "city"),
];

const matches = (list: Place[], q: string) => {
  const words = q.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return list.filter((p) => words.every((w) => p.formatted.toLowerCase().includes(w)));
};

/** Searches the list above, after a short wait, as the proxy would. A level drops what it never offers. */
export const samplePlaceSearch: SearchPlaces = (q, opts) =>
  new Promise((resolve) =>
    setTimeout(() => {
      const level = opts?.level ?? "address";
      const list = level === "city" ? SAMPLE_CITIES : SAMPLE_PLACES.filter((p) => level === "area" || p.kind !== "area");
      resolve(matches(list, q).slice(0, 6));
    }, 120),
  );

const nearestOf = (list: Place[], { lat, lon }: LatLon) => [...list].sort((a, b) => Math.hypot(a.lat - lat, a.lon - lon) - Math.hypot(b.lat - lat, b.lon - lon))[0]!;

/** The address search, the pin and the token reader, answered from the lists above. */
export const samplePlaces: Places = {
  search: samplePlaceSearch,
  pin: (point, opts) =>
    new Promise((resolve) =>
      setTimeout(() => {
        const near = nearestOf(opts?.level === "city" ? SAMPLE_CITIES : SAMPLE_PLACES, point);
        const formatted = opts?.level === "city" ? near.formatted : `Near ${near.formatted}`;
        resolve({ place_id: `pin-${point.lat},${point.lon}`, formatted, lat: point.lat, lon: point.lon, kind: near.kind, token: sampleToken({ source: "pin", formatted, lat: point.lat, lon: point.lon, kind: near.kind }) });
      }, 200),
    ),
  read: readSampleToken,
  loadTile: () => fetch(SAMPLE_TILE).then((r) => r.blob()),
};

/** The same, with address search down: every search and pin answers as an outage does (503). */
export const offlinePlaces: Places = {
  ...samplePlaces,
  search: () => Promise.reject(Object.assign(new Error("Maps are not set up."), { status: 503 })),
  pin: () => Promise.reject(Object.assign(new Error("Maps are not set up."), { status: 503 })),
};

/** Answers with the nearest sample address. */
export const sampleResolve: ResolveAddress = (point) =>
  new Promise((resolve) => setTimeout(() => resolve(nearestOf(SAMPLE_PLACES, point).formatted), 500));
