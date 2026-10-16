/**
 * Sample places for the Maps group's gallery pages, and the two lookups it
 * needs, answered from this list instead of the API. Not exported from the
 * package; a screen's lookups go through the app's own client.
 */
import type { LatLon, Place, ResolveAddress, SearchPlaces } from "./geoapify";

/**
 * The tile the gallery draws with: one flat pixel, as a data URL, so a page of
 * maps asks the network for nothing. A screen's tiles come from our own proxy
 * (`TILES`), which the gallery has no server for.
 */
export const SAMPLE_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mN49OIZAAVgArHOP1vTAAAAAElFTkSuQmCC";

export const LEKKI: LatLon = { lat: 6.4321, lon: 3.4219 };
export const IKEJA: LatLon = { lat: 6.6018, lon: 3.3515 };

export const SAMPLE_PLACES: Place[] = [
  { place_id: "p1", formatted: "12 Admiralty Way, Lekki Phase 1, Lagos", lat: 6.4321, lon: 3.4219 },
  { place_id: "p2", formatted: "4 Admiralty Road, Lekki Phase 1, Lagos", lat: 6.4338, lon: 3.4255 },
  { place_id: "p3", formatted: "Ikeja Depot, Oba Akran Avenue, Ikeja, Lagos", lat: 6.6018, lon: 3.3515 },
  { place_id: "p4", formatted: "Apapa Yard, Creek Road, Apapa, Lagos", lat: 6.4474, lon: 3.3595 },
];

/** Searches the list above, after a short wait, as the proxy would. */
export const samplePlaceSearch: SearchPlaces = (q) =>
  new Promise((resolve) => setTimeout(() => resolve(SAMPLE_PLACES.filter((p) => p.formatted.toLowerCase().includes(q.toLowerCase()))), 350));

/** Answers with the nearest sample address. */
export const sampleResolve: ResolveAddress = ({ lat, lon }) =>
  new Promise((resolve) =>
    setTimeout(() => {
      const nearest = [...SAMPLE_PLACES].sort((a, b) => Math.hypot(a.lat - lat, a.lon - lon) - Math.hypot(b.lat - lat, b.lon - lon))[0];
      resolve(nearest?.formatted ?? "Somewhere in Lagos");
    }, 500),
  );
