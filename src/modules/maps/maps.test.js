"use strict";
/**
 * Maps: the contract, the routes, and what the Geoapify client makes of the provider's
 * answers for the address search, the tiles and a worksite's address. The provider is a
 * stub here; nothing leaves the machine. The places are invented.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const geoapify = require("../../services/maps/geoapify.service");

const answer = (results, status = 200) =>
  jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ results }) }));

beforeEach(() => geoapify.clearCache());

describe("the contract", () => {
  test("a search needs three characters and at most 200", () => {
    expect(c.maps.PlaceSearchQuery.safeParse({ q: "ab" }).success).toBe(false);
    expect(c.maps.PlaceSearchQuery.safeParse({ q: "  ab  " }).success).toBe(false);
    expect(c.maps.PlaceSearchQuery.safeParse({ q: "Admiralty" }).success).toBe(true);
    expect(c.maps.PlaceSearchQuery.safeParse({ q: "x".repeat(201) }).success).toBe(false);
  });

  test("an answer carries at most six places", () => {
    const place = { place_id: "p", formatted: "Testbed Road", lat: 6.5, lon: 3.4 };
    expect(c.maps.PlaceMatches.safeParse({ places: Array(6).fill(place) }).success).toBe(true);
    expect(c.maps.PlaceMatches.safeParse({ places: Array(7).fill(place) }).success).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./maps.routes").router);
  const at = (path) => routes.find((r) => r.path === path);

  test("anyone signed in may search and see a map, with no module grant", () => {
    expect(routes).toHaveLength(3);
    for (const path of ["/search", "/tiles/:z/:x/:y.png"]) {
      expect(at(path).contract.self).toBe(true);
      expect(at(path).permission).toBeFalsy();
    }
    expect(at("/tiles/:z/:x/:y.png").contract.no_content).toBe(true);
  });

  test("an address for a point needs the grants that set worksites up", () => {
    expect(at("/reverse").contract.self).toBeFalsy();
    expect(at("/reverse").permission).toBeTruthy();
  });

  test("a tile must exist at its zoom; a point must be degrees", () => {
    const tile = (z, x, y) => c.maps.TileParams.safeParse({ z, x, y }).success;
    expect(tile("15", "18525", "15632")).toBe(true);
    expect(tile("0", "0", "0")).toBe(true);
    expect(tile("2", "4", "0")).toBe(false);
    expect(tile("21", "0", "0")).toBe(false);
    expect(tile("15", "-1", "0")).toBe(false);
    const point = (lat, lon) => c.maps.PointQuery.safeParse({ lat, lon }).success;
    expect(point("6.4321", "3.4219")).toBe(true);
    expect(point("", "3.4")).toBe(false);
    expect(point("91", "3.4")).toBe(false);
    expect(point("6.4", "east")).toBe(false);
  });
});

describe("searching", () => {
  test("places come back with their point, the provider's extras dropped", async () => {
    const fetchImpl = answer([
      { place_id: "a1", formatted: "1 Testbed Road, Lagos", lat: 6.45, lon: 3.42, rank: { confidence: 1 }, city: "Lagos" },
    ]);
    const places = await geoapify.searchPlaces("1 Testbed Road", { apiKey: "k", fetchImpl });
    expect(places).toEqual([{ place_id: "a1", formatted: "1 Testbed Road, Lagos", lat: 6.45, lon: 3.42 }]);
  });

  test("the request is biased to Lagos, not filtered, and carries the key", async () => {
    const fetchImpl = answer([]);
    await geoapify.searchPlaces("Testbed Road", { apiKey: "secret-key", fetchImpl });
    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get("text")).toBe("Testbed Road");
    expect(url.searchParams.get("bias")).toBe("proximity:3.3947,6.4541|countrycode:ng");
    expect(url.searchParams.get("filter")).toBeNull();
    expect(url.searchParams.get("apiKey")).toBe("secret-key");
  });

  test("a result without a point, outside the globe or without an address is dropped", async () => {
    const fetchImpl = answer([
      { place_id: "none", formatted: "Nowhere", lat: null, lon: null },
      { place_id: "blank", formatted: "Blank", lat: "", lon: "" },
      { place_id: "far", formatted: "Off The Map", lat: 120, lon: 3 },
      { place_id: "unnamed", lat: 6.4, lon: 3.4 },
      { place_id: "ok", formatted: "2 Testbed Road", lat: "6.46", lon: "3.43" },
    ]);
    const places = await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl });
    expect(places.map((p) => p.place_id)).toEqual(["ok"]);
    expect(places[0].lat).toBe(6.46);
  });

  test("the same point twice is one suggestion, and six at most", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ place_id: `p${i}`, formatted: `${i} Testbed Road`, lat: 6.4 + i / 100, lon: 3.4 }));
    const fetchImpl = answer([{ place_id: "dup", formatted: "0 Testbed Road again", lat: 6.4, lon: 3.4 }, ...many]);
    const places = await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl });
    expect(places).toHaveLength(6);
    expect(places[0].place_id).toBe("dup");
    expect(places.map((p) => p.place_id)).not.toContain("p0");
  });

  test("fewer than three characters asks nobody", async () => {
    const fetchImpl = answer([]);
    expect(await geoapify.searchPlaces(" ab ", { apiKey: "k", fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("the same text again is answered from memory", async () => {
    const fetchImpl = answer([{ place_id: "a", formatted: "Testbed Road", lat: 6.4, lon: 3.4 }]);
    await geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl });
    await geoapify.searchPlaces("  testbed   road ", { apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("when the provider cannot answer", () => {
  test("no key is 503 MAPS_OFF, and nothing is asked", async () => {
    const fetchImpl = answer([]);
    await expect(geoapify.searchPlaces("Testbed", { apiKey: "", fetchImpl })).rejects.toMatchObject({ code: "MAPS_OFF", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("over the quota is 429 MAPS_BUSY", async () => {
    await expect(geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl: answer([], 429) })).rejects.toMatchObject({ code: "MAPS_BUSY", status: 429 });
  });

  test("a refusal or a timeout is 502 MAPS_UNAVAILABLE, and the key is not in the error", async () => {
    await expect(geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl: answer([], 401) })).rejects.toMatchObject({ code: "MAPS_UNAVAILABLE", status: 502 });
    const timeout = jest.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const err = await geoapify.searchPlaces("Testbed", { apiKey: "secret-key", fetchImpl: timeout }).catch((e) => e);
    expect(err).toMatchObject({ code: "MAPS_UNAVAILABLE", status: 502 });
    expect(JSON.stringify({ message: err.message, code: err.code })).not.toContain("secret-key");
  });

  test("a failed search is not remembered", async () => {
    await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl: answer([], 500) }).catch(() => undefined);
    const fetchImpl = answer([{ place_id: "a", formatted: "Testbed Road", lat: 6.4, lon: 3.4 }]);
    expect(await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl })).toHaveLength(1);
  });
});

const png = (status = 200, type = "image/png") =>
  jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? type : null) },
    arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
  }));

describe("map tiles", () => {
  test("a tile comes back as the provider's PNG, asked for with the server's key", async () => {
    const fetchImpl = png();
    const t = await geoapify.tile(15, 18525, 15632, { apiKey: "secret-key", fetchImpl });
    expect(t.type).toBe("image/png");
    expect([...t.bytes]).toEqual([137, 80, 78, 71]);
    const url = fetchImpl.mock.calls[0][0];
    expect(url.pathname).toBe("/v1/tile/osm-bright/15/18525/15632.png");
    expect(url.searchParams.get("apiKey")).toBe("secret-key");
  });

  test("the same tile again is answered from memory", async () => {
    const fetchImpl = png();
    await geoapify.tile(15, 1, 2, { apiKey: "k", fetchImpl });
    await geoapify.tile(15, 1, 2, { apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a tile that cannot exist is a 404, and nobody is asked", async () => {
    const fetchImpl = png();
    await expect(geoapify.tile(2, 4, 0, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ status: 404 });
    await expect(geoapify.tile(21, 0, 0, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("anything but an image from the provider is a failure, never passed on", async () => {
    await expect(geoapify.tile(3, 1, 1, { apiKey: "k", fetchImpl: png(200, "text/html") })).rejects.toMatchObject({ code: "MAPS_UNAVAILABLE" });
  });

  test("no key is 503 MAPS_OFF; over the quota 429", async () => {
    await expect(geoapify.tile(3, 1, 1, { apiKey: "", fetchImpl: png() })).rejects.toMatchObject({ code: "MAPS_OFF", status: 503 });
    await expect(geoapify.tile(3, 1, 1, { apiKey: "k", fetchImpl: png(429) })).rejects.toMatchObject({ code: "MAPS_BUSY", status: 429 });
  });
});

describe("a worksite's address", () => {
  const found = (results, status = 200) =>
    jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ results }) }));

  test("the provider's address for the point, asked for by its coordinates", async () => {
    const fetchImpl = found([{ formatted: "12 Testbed Road, Lagos", lat: 6.4321, lon: 3.4219 }]);
    expect(await geoapify.reverseGeocode(6.4321, 3.4219, { apiKey: "k", fetchImpl })).toBe("12 Testbed Road, Lagos");
    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get("lat")).toBe("6.4321");
    expect(url.searchParams.get("lon")).toBe("3.4219");
  });

  test("null when the provider knows no address there, and that is remembered too", async () => {
    const fetchImpl = found([]);
    expect(await geoapify.reverseGeocode(0.5, 0.5, { apiKey: "k", fetchImpl })).toBeNull();
    expect(await geoapify.reverseGeocode(0.5, 0.5, { apiKey: "k", fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a point off the globe is refused before anyone is asked; no key is 503", async () => {
    const fetchImpl = found([]);
    await expect(geoapify.reverseGeocode(95, 3, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ status: 422 });
    await expect(geoapify.reverseGeocode(6.4, 3.4, { apiKey: "", fetchImpl })).rejects.toMatchObject({ code: "MAPS_OFF" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
