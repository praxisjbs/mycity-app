import maps from "@mycity/contract/schemas/maps.js";
import type { PlaceView } from "@mycity/contract/contract.gen.ts";
import type { LatLon, LoadTile, Place, Places, PlaceSummary, PlaceValue } from "@mycity/ui";
import { api } from "@/api/client";
import { fetchBlob } from "@/api/download";

/**
 * Addresses and maps bound to this app's API (F21, F27, docs/guides/addresses.md): every call
 * goes through our own routes, so the provider's key never reaches the browser. Every address
 * field takes `places`:
 *
 *   const f = useContractForm({ address: placeValue(org.address_place) }, settings.OrganisationPatch);
 *   <AddressField {...f.field("address")} places={places} />            // the form sends f.values.address
 *   <AddressField {...f.field("location")} places={places} level="area" />
 *   <PlacesField {...f.field("cities")} places={places} />
 */

/**
 * Each map tile fetched with the session, since the tile route is signed in. On the
 * in-browser mock there are no tiles to fetch, so the map draws its points on a blank ground.
 */
export const loadTile: LoadTile = (url) =>
  import.meta.env.VITE_API_MODE === "mock" ? Promise.reject(new Error("No tiles on the mock")) : fetchBlob(url);

/** What a token says, or null when it is not one of ours in shape (the contract reads it; the server checks it). */
const read = (token: string) => maps.readPlaceToken(token) as PlaceSummary | null;

/**
 * A point's degrees as the pin's query takes them: six places, about 10 cm, as a place keeps them
 * (`numeric(9,6)`). A tap on the map carries fifteen, which the contract refuses.
 */
export const degreesOf = (n: number) => n.toFixed(6);

/** The address search, the pin and the token reader every address field takes. */
export const places: Places = {
  search: (q, opts) => api.call("GET /api/v1/maps/search", { query: { q, level: opts?.level }, signal: opts?.signal }).then((r) => r.places),
  pin: (point, opts) => api.call("GET /api/v1/maps/pin", { query: { lat: degreesOf(point.lat), lon: degreesOf(point.lon), level: opts?.level } }),
  read,
  loadTile,
};

/** A record's saved address as its edit form holds it, so an address left alone goes back as it came. */
export const placeValue = (view: PlaceView | null | undefined): PlaceValue | null => (view ? { token: view.token, details: view.details } : null);

/** The address line a form's value reads as, details first, for a map's label beside the field. */
export function lineOf(value: PlaceValue | null | undefined): string | null {
  if (!value) return null;
  const summary = value.token ? read(value.token) : null;
  const address = summary?.formatted ?? (value.device ? "Current location" : null);
  return [value.details, address].filter((s): s is string => !!s && !!s.trim()).join(", ") || null;
}

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
