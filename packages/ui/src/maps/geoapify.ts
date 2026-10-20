/**
 * Where the map's pieces come from (F21, F27). Leaflet draws; Geoapify supplies the
 * tiles, the address search and the pin's nearest address, and ALL THREE go through
 * our own API, so the Geoapify key never reaches a browser.
 *
 * These are the paths our API answers on (the `maps` module, docs/guides/addresses.md
 * §5); a screen may pass its own. The tile route is signed in like every staff
 * route, so a screen hands the map a `LoadTile` that fetches with its session.
 *
 * An address is picked, never typed (F27): a form holds a `PlaceValue`, which is what
 * the contract's `PlaceInput` takes: the token our search or pin signed, or the
 * device's location while address search is down, and the Details line. The app
 * binds the search, the pin and the reading of a token once (`Places`), in its
 * `features/shared/places.ts`.
 */

/** The tile path, with Leaflet's own placeholders left in it. */
export const TILES = "/api/v1/maps/tiles/{z}/{x}/{y}.png";

/** Address search: `?q=&level=` and up to six signed places. */
export const SEARCH = "/api/v1/maps/search";

/** A pinned point's nearest address: `?lat=&lon=&level=` and one signed place. */
export const PIN = "/api/v1/maps/pin";

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

/** What a pick may be: a door (`address`), anything from a door to a city (`area`), a city. */
export type PlaceLevel = "address" | "area" | "city";

/** What a place is, from the provider's own type. */
export type PlaceKind = "building" | "street" | "landmark" | "area" | "city" | "region" | "country" | "unknown";

/** A place the address search found, or a pin named. */
export interface Place extends LatLon {
  /** Its own id from the provider, for the key. */
  place_id: string;
  /** The address on one line, as a person reads it. */
  formatted: string;
  /** What it is: a building, a street, a landmark, an area, a city. */
  kind?: PlaceKind;
  /** Our API's signature over the place: what a form sends back to save it. */
  token?: string;
}

/** The device's reading, given as the address while address search is down. */
export interface DevicePoint extends LatLon {
  /** How far off the reading may be, in metres. */
  accuracy_m: number;
}

/** An address as a form holds and sends it (the contract's `PlaceInput`). */
export interface PlaceValue {
  /** A pick, a pin, or the record's own place sent back as it came. */
  token?: string;
  /** The device's location, only while address search is down. */
  device?: DevicePoint;
  /** House number, flat or directions: printed before the address. */
  details?: string | null;
}

/** What a token says, for the field to show (the contract's `readPlaceToken`). */
export interface PlaceSummary {
  /** Picked, pinned, the device's location, or typed before addresses were picked. */
  source: "search" | "pin" | "device" | "typed";
  /** The address line; null while a device location waits to be named. */
  formatted: string | null;
  lat: number | null;
  lon: number | null;
  kind: PlaceKind;
  /** False for an address typed before addresses were picked. */
  verified: boolean;
  /** A device location not yet named. */
  pending: boolean;
}

/** How a screen searches for an address: its own API call, so no key is in the browser. */
export type SearchPlaces = (q: string, opts?: { level?: PlaceLevel; signal?: AbortSignal }) => Promise<Place[]>;

/** How a screen names a point a person pinned: its own API call, answering a signed place. */
export type PinPlace = (point: LatLon, opts?: { level?: PlaceLevel }) => Promise<Place>;

/** How a screen turns a point into an address line: its own API call. */
export type ResolveAddress = (point: LatLon) => Promise<string>;

/**
 * How a screen fetches one tile: its own call with its session, because our tile route
 * is signed in and a plain image request carries no token. The map draws the bytes.
 */
export type LoadTile = (url: string) => Promise<Blob>;

/** Everything an address field needs from the app, bound once (`features/shared/places.ts`). */
export interface Places {
  /** The address search. */
  search: SearchPlaces;
  /** A pinned point's nearest address. */
  pin: PinPlace;
  /** What a token says, or null when it is not one of ours in shape. */
  read: (token: string) => PlaceSummary | null;
  /** The map's tiles, fetched with the session. */
  loadTile?: LoadTile;
}

/** A point written out for anyone who cannot see the map. */
export const describePoint = ({ lat, lon }: LatLon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
