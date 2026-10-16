/**
 * Where the map's pieces come from (F21). Leaflet draws; Geoapify supplies the
 * tiles, the address search and the reverse lookup, and ALL THREE go through
 * our own API, so the Geoapify key never reaches a browser.
 *
 * These are the paths the backend's proxy answers on. They are agreed here so
 * the components can be built before the attendance and worksite routes land
 * (FRONTEND_FOUNDATION F21: "the proxy routes are backend work"); a screen may
 * pass its own, and the apps' INTERIM types name the same shapes.
 */

/** The tile path, with Leaflet's own placeholders left in it. */
export const TILES = "/api/v1/maps/tiles/{z}/{x}/{y}.png";

/** Address search: `?q=` and a page of places. */
export const SEARCH = "/api/v1/maps/search";

/** Reverse lookup: `?lat=&lon=` and one address. */
export const REVERSE = "/api/v1/maps/reverse";

/**
 * What the licence requires on the map, whoever supplies the tiles. It is not
 * product copy, so the copy gates do not count it, and it is never removed.
 */
export const ATTRIBUTION = "Geoapify, OpenStreetMap contributors";

/** Lagos, where the map opens when a screen has no point of its own. */
export const LAGOS: LatLon = { lat: 6.4541, lon: 3.3947 };

/** A point on the map. Latitude and longitude, as every route sends them. */
export interface LatLon {
  /** Degrees north, -90 to 90. */
  lat: number;
  /** Degrees east, -180 to 180. */
  lon: number;
}

/** A place the address search found. */
export interface Place extends LatLon {
  /** Its own id from the provider, for the key. */
  place_id: string;
  /** The address on one line, as a person reads it. */
  formatted: string;
}

/** How a screen searches for an address: its own API call, so no key is in the browser. */
export type SearchPlaces = (q: string) => Promise<Place[]>;

/** How a screen turns a point into an address: its own API call. */
export type ResolveAddress = (point: LatLon) => Promise<string>;

/** A point written out for anyone who cannot see the map. */
export const describePoint = ({ lat, lon }: LatLon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
