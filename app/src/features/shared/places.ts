import type { LatLon, LoadTile, Place, ResolveAddress, SearchPlaces } from "@mycity/ui";
import { api } from "@/api/client";
import { fetchBlob } from "@/api/download";

/**
 * The maps bound to this app's API (F21, docs/guides/foundation.md §6.12): every call
 * goes through our own routes, so the provider's key never reaches the browser.
 */

/** The address search every location field takes (`AddressField`). */
export const searchPlaces: SearchPlaces = (q) => api.call("GET /api/v1/maps/search", { query: { q } }).then((r) => r.places);

/** A picked place's centre as the text a coordinate field holds, to about 10 cm. */
export const coordinatesOf = (place: Place) => ({ latitude: place.lat.toFixed(6), longitude: place.lon.toFixed(6) });

/** The centre typed so far, once both coordinate fields hold real coordinates; null until then. */
export const pointOf = (latitude: string, longitude: string): LatLon | null => {
  if (!latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude);
  const lon = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
};

/** Close enough that a fence of this radius, in metres, shows whole on a small map. */
export const zoomFor = (radius: number) => (radius <= 150 ? 16 : radius <= 400 ? 15 : 14);

/**
 * Each map tile fetched with the session, since the tile route is signed in. On the
 * in-browser mock there are no tiles to fetch, so the map draws its points on a blank ground.
 */
export const loadTile: LoadTile = (url) =>
  import.meta.env.VITE_API_MODE === "mock" ? Promise.reject(new Error("No tiles on the mock")) : fetchBlob(url);

/**
 * The address at a worksite's centre. For worksites only (decided 19/10/2026): a home or
 * a punch is never sent to the provider, and the route answers only those who set
 * worksites up. Rejects when the provider knows no address there.
 */
export const resolveWorksiteAddress: ResolveAddress = (point) =>
  api.call("GET /api/v1/maps/reverse", { query: { lat: String(point.lat), lon: String(point.lon) } }).then((r) => {
    if (!r.formatted) throw new Error("No address here");
    return r.formatted;
  });
