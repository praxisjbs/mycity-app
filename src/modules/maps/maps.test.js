"use strict";
/**
 * Maps: the address search's contract, its route, and what the Geoapify client makes of
 * the provider's answers. The provider is a stub here; nothing leaves the machine. The
 * places are invented.
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

describe("the route", () => {
  test("anyone signed in may search, with no module grant", () => {
    const routes = routesOf(require("./maps.routes").router);
    expect(routes).toHaveLength(1);
    expect(routes[0].contract.self).toBe(true);
    expect(routes[0].permission).toBeFalsy();
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
