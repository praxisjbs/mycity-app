import type { Place, SearchPlaces } from "@mycity/ui";
import { api } from "@/api/client";

/**
 * The address search every location field takes (`AddressField`, F21): our own API,
 * so the provider's key never reaches the browser.
 */
export const searchPlaces: SearchPlaces = (q) => api.call("GET /api/v1/maps/search", { query: { q } }).then((r) => r.places);

/** A picked place's centre as the text a coordinate field holds, to about 10 cm. */
export const coordinatesOf = (place: Place) => ({ latitude: place.lat.toFixed(6), longitude: place.lon.toFixed(6) });
