"use strict";
/**
 * Maps and addresses (docs/guides/addresses.md): the contract, the routes, what the Geoapify
 * client makes of the provider's answers for the address search, a pin and the tiles, the token
 * on every place, and how a place is kept and named. The provider is a stub and the database a
 * fake here; nothing leaves the machine. The places are invented.
 */
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const geoapify = require("../../services/maps/geoapify.service");
const token = require("../../shared/places/token");
const places = require("../../shared/places/places");
const owners = require("../../shared/places/owners");

const answer = (results, status = 200) =>
  jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => ({ results }) }));

/** A place as /maps/search signs it. */
const PICK = Object.freeze({
  source: "search",
  formatted: "12 Testbed Road, Ikeja, Lagos",
  lat: 6.6018,
  lon: 3.3515,
  provider_id: "prov-12",
  kind: "building",
  city: "Lagos",
  state: "Lagos State",
  country_code: "ng",
  verified: true,
  pending: false,
});

const parse = (v) => c.maps.PlaceInput.safeParse(v);
const messages = (r) => (r.success ? [] : r.error.issues.map((i) => i.message));

beforeEach(() => geoapify.clearCache());

describe("the contract", () => {
  test("a search starts at the second character, at most 200, at a level that exists", () => {
    const q = (v) => c.maps.PlaceSearchQuery.safeParse(v).success;
    expect(q({ q: "a" })).toBe(false);
    expect(q({ q: "  a  " })).toBe(false);
    expect(q({ q: "Ad" })).toBe(true);
    expect(q({ q: "x".repeat(201) })).toBe(false);
    expect(q({ q: "Ikeja", level: "city" })).toBe(true);
    expect(q({ q: "Ikeja", level: "town" })).toBe(false);
  });

  test("an answer carries at most six places, each signed and of a kind", () => {
    const place = { place_id: "p", formatted: "Testbed Road", lat: 6.5, lon: 3.4, kind: "street", token: "t" };
    expect(c.maps.PlaceMatches.safeParse({ places: Array(6).fill(place) }).success).toBe(true);
    expect(c.maps.PlaceMatches.safeParse({ places: Array(7).fill(place) }).success).toBe(false);
    const { token: _unsigned, ...unsigned } = place;
    expect(c.maps.PlaceMatches.safeParse({ places: [unsigned] }).success).toBe(false);
  });

  test("a tile must exist at its zoom; a pin must be degrees", () => {
    const tile = (z, x, y) => c.maps.TileParams.safeParse({ z, x, y }).success;
    expect(tile("15", "18525", "15632")).toBe(true);
    expect(tile("0", "0", "0")).toBe(true);
    expect(tile("2", "4", "0")).toBe(false);
    expect(tile("21", "0", "0")).toBe(false);
    expect(tile("15", "-1", "0")).toBe(false);
    const pin = (lat, lon, level) => c.maps.PinQuery.safeParse({ lat, lon, level }).success;
    expect(pin("6.4321", "3.4219")).toBe(true);
    expect(pin("6.4321", "3.4219", "city")).toBe(true);
    expect(pin("", "3.4")).toBe(false);
    expect(pin("91", "3.4")).toBe(false);
    expect(pin("6.4", "east")).toBe(false);
  });
});

describe("an address in a request body", () => {
  test("a pick from our search is the place itself, with its details", () => {
    const r = parse({ token: token.sign(PICK), details: "  Flat 3, blue gate  " });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ ...PICK, details: "Flat 3, blue gate", accuracy_m: null });
  });

  test("anything typed is refused: a line, a details line alone, a token we never made", () => {
    expect(parse("12 Testbed Road").success).toBe(false);
    expect(messages(parse({}))).toEqual(["Pick an address"]);
    expect(messages(parse({ details: "Flat 3" }))).toEqual(["Pick an address"]);
    expect(messages(parse({ token: "p1.bm90LWEtcGxhY2U.c2lnbmF0dXJl" }))).toEqual(["Pick an address"]);
    expect(parse({ token: token.sign(PICK), formatted: "12 Testbed Road" }).success).toBe(false);
  });

  test("a token altered after we signed it is refused", () => {
    const [v, , sig] = token.sign(PICK).split(".");
    const forged = Buffer.from(JSON.stringify({ s: "search", f: "1 Forged Lane", la: 6.6, lo: 3.3, k: "building", v: true, p: false })).toString("base64url");
    expect(messages(parse({ token: `${v}.${forged}.${sig}` }))).toEqual(["Pick an address"]);
  });

  test("a pick and a device location together are refused", () => {
    expect(parse({ token: token.sign(PICK), device: { lat: 6.6, lon: 3.3, accuracy_m: 10 } }).success).toBe(false);
  });

  test("the device's location stands in while search is down, waiting to be named", () => {
    const r = parse({ device: { lat: 6.43210, lon: 3.42190, accuracy_m: 12 } });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ source: "device", formatted: null, lat: 6.4321, lon: 3.4219, accuracy_m: 12, verified: false, pending: true, details: null });
    expect(parse({ device: { lat: 95, lon: 3.4, accuracy_m: 12 } }).success).toBe(false);
  });

  test("details are at most 120 characters, and blank is none", () => {
    expect(parse({ token: token.sign(PICK), details: "" }).data.details).toBeNull();
    expect(parse({ token: token.sign(PICK), details: null }).data.details).toBeNull();
    expect(messages(parse({ token: token.sign(PICK), details: "x".repeat(121) }))).toEqual(["Too long"]);
  });

  test("a process with no check installed refuses every token, so nothing unchecked is ever saved", () => {
    jest.isolateModules(() => {
      const bare = require("@mycity/contract");
      expect(bare.maps.PlaceInput.safeParse({ token: token.sign(PICK) }).success).toBe(false);
      expect(bare.maps.PlaceInput.safeParse({ device: { lat: 6.6, lon: 3.3, accuracy_m: 10 } }).success).toBe(true);
    });
  });
});

describe("the token", () => {
  test("it reads back as the place it was made from, details never inside", () => {
    const t = token.sign({ ...PICK, details: "Flat 3" });
    expect(t.split(".")).toHaveLength(3);
    expect(t.startsWith("p1.")).toBe(true);
    expect(c.maps.readPlaceToken(t)).toEqual({ ...PICK, accuracy_m: null });
    expect(Buffer.from(t.split(".")[1], "base64url").toString()).not.toContain("Flat 3");
  });

  test("only a token this environment made, unaltered, verifies", () => {
    const t = token.sign(PICK);
    expect(token.verify(t)).toBe(true);
    expect(token.verify(`${t}x`)).toBe(false);
    expect(token.verify(t.replace(/^p1\./, "p2."))).toBe(false);
    expect(token.verify(t.slice(0, t.lastIndexOf(".")))).toBe(false);
    expect(token.verify(null)).toBe(false);
  });

  test("a place typed before addresses were picked signs without a point; a picked one never does", () => {
    const typed = token.sign({ source: "typed", formatted: "Old Line, Lagos", verified: false, pending: false });
    expect(c.maps.readPlaceToken(typed)).toMatchObject({ source: "typed", lat: null, lon: null, verified: false });
    expect(c.maps.readPlaceToken(token.sign({ ...PICK, lat: null, lon: null }))).toBeNull();
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./maps.routes").router);
  const at = (path) => routes.find((r) => r.path === path);

  test("anyone signed in may search, pin and see a map, with no module grant", () => {
    expect(routes.map((r) => r.path).sort()).toEqual(["/pin", "/search", "/tiles/:z/:x/:y.png"]);
    for (const r of routes) {
      expect(r.contract.self).toBe(true);
      expect(r.permission).toBeFalsy();
    }
    expect(at("/tiles/:z/:x/:y.png").contract.no_content).toBe(true);
  });
});

describe("searching", () => {
  test("places come back with their point and kind, the provider's extras dropped", async () => {
    const fetchImpl = answer([
      { place_id: "a1", formatted: "1 Testbed Road, Lagos", lat: 6.45, lon: 3.42, result_type: "building", rank: { confidence: 1 }, city: "Lagos", country_code: "NG" },
    ]);
    const found = await geoapify.searchPlaces("1 Testbed Road", { apiKey: "k", fetchImpl });
    expect(found).toEqual([
      { place_id: "a1", formatted: "1 Testbed Road, Lagos", lat: 6.45, lon: 3.42, kind: "building", city: "Lagos", state: null, country_code: "ng" },
    ]);
  });

  test("the request is biased to Lagos, not filtered, asks for more than a field shows, and carries the key", async () => {
    const fetchImpl = answer([]);
    await geoapify.searchPlaces("Testbed Road", { apiKey: "secret-key", fetchImpl });
    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get("text")).toBe("Testbed Road");
    expect(url.searchParams.get("bias")).toBe("proximity:3.3947,6.4541|countrycode:ng");
    expect(url.searchParams.get("filter")).toBeNull();
    expect(url.searchParams.get("type")).toBeNull();
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("apiKey")).toBe("secret-key");
  });

  test("a level offers only its kinds: a door, anything to a city, or cities", async () => {
    const results = [
      { place_id: "b", formatted: "4 Testbed Road", lat: 6.41, lon: 3.4, result_type: "building" },
      { place_id: "l", formatted: "Testbed Mall", lat: 6.42, lon: 3.4, result_type: "amenity" },
      { place_id: "s", formatted: "Testbed Estate", lat: 6.43, lon: 3.4, result_type: "suburb" },
      { place_id: "c", formatted: "Testbed City", lat: 6.44, lon: 3.4, result_type: "city" },
      { place_id: "r", formatted: "Testbed State", lat: 6.45, lon: 3.4, result_type: "state" },
    ];
    const ids = async (level) => (await geoapify.searchPlaces(`Testbed ${level}`, { level, apiKey: "k", fetchImpl: answer(results) })).map((p) => p.place_id);
    expect(await ids("address")).toEqual(["b", "l"]);
    expect(await ids("area")).toEqual(["b", "l", "s", "c"]);
    expect(await ids("city")).toEqual(["c"]);
  });

  test("a search for cities asks the provider for cities", async () => {
    const fetchImpl = answer([]);
    await geoapify.searchPlaces("Ibadan", { level: "city", apiKey: "k", fetchImpl });
    expect(fetchImpl.mock.calls[0][0].searchParams.get("type")).toBe("city");
  });

  test("a result without a point, outside the globe or without an address is dropped", async () => {
    const fetchImpl = answer([
      { place_id: "none", formatted: "Nowhere", lat: null, lon: null },
      { place_id: "blank", formatted: "Blank", lat: "", lon: "" },
      { place_id: "far", formatted: "Off The Map", lat: 120, lon: 3 },
      { place_id: "unnamed", lat: 6.4, lon: 3.4 },
      { place_id: "ok", formatted: "2 Testbed Road", lat: "6.46", lon: "3.43" },
    ]);
    const found = await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl });
    expect(found.map((p) => p.place_id)).toEqual(["ok"]);
    expect(found[0]).toMatchObject({ lat: 6.46, kind: "unknown" });
  });

  test("the same point twice is one suggestion, and six at most", async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ place_id: `p${i}`, formatted: `${i} Testbed Road`, lat: 6.4 + i / 100, lon: 3.4 }));
    const fetchImpl = answer([{ place_id: "dup", formatted: "0 Testbed Road again", lat: 6.4, lon: 3.4 }, ...many]);
    const found = await geoapify.searchPlaces("Testbed", { apiKey: "k", fetchImpl });
    expect(found).toHaveLength(6);
    expect(found[0].place_id).toBe("dup");
    expect(found.map((p) => p.place_id)).not.toContain("p0");
  });

  test("one character asks nobody; the second does", async () => {
    const fetchImpl = answer([]);
    expect(await geoapify.searchPlaces(" a ", { apiKey: "k", fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await geoapify.searchPlaces("Ad", { apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("the same text again is answered from memory, at the same level only", async () => {
    const fetchImpl = answer([{ place_id: "a", formatted: "Testbed Road", lat: 6.4, lon: 3.4 }]);
    await geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl });
    await geoapify.searchPlaces("  testbed   road ", { apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await geoapify.searchPlaces("Testbed Road", { level: "area", apiKey: "k", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("the same text asked twice at once is one request", async () => {
    const fetchImpl = answer([{ place_id: "a", formatted: "Testbed Road", lat: 6.4, lon: 3.4 }]);
    const [a, b] = await Promise.all([
      geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl }),
      geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl }),
    ]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("past the provider's rate a search is refused as busy, not queued for long", async () => {
    const fetchImpl = answer([]);
    const asked = await Promise.allSettled(
      Array.from({ length: geoapify.RATE + 1 }, (_, i) => geoapify.searchPlaces(`Testbed ${i} Road`, { apiKey: "k", fetchImpl })),
    );
    expect(asked.filter((a) => a.status === "fulfilled")).toHaveLength(geoapify.RATE);
    expect(asked.find((a) => a.status === "rejected").reason).toMatchObject({ code: "MAPS_BUSY", status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(geoapify.RATE);
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

  // Fault #1 (staging, 20/10/2026): the request to the provider got no answer at all.
  const dropped = () =>
    Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
  const timedOut = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const found = { ok: true, status: 200, json: async () => ({ results: [{ place_id: "a", formatted: "Testbed Road", lat: 6.4, lon: 3.4 }] }) };

  test("a dropped connection is asked once more at once, and the person never sees it", async () => {
    const fetchImpl = jest.fn().mockRejectedValueOnce(dropped()).mockResolvedValue(found);
    expect(await geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl })).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("dropped twice, it is the provider's outage; a timeout is never asked again", async () => {
    const twice = jest.fn().mockRejectedValue(dropped());
    await expect(geoapify.searchPlaces("Testbed Road", { apiKey: "k", fetchImpl: twice })).rejects.toMatchObject({ code: "MAPS_UNAVAILABLE", status: 502 });
    expect(twice).toHaveBeenCalledTimes(2);
    const slow = jest.fn().mockRejectedValue(timedOut());
    await expect(geoapify.searchPlaces("Testbed Lane", { apiKey: "k", fetchImpl: slow })).rejects.toMatchObject({ code: "MAPS_UNAVAILABLE", timed_out: true });
    expect(slow).toHaveBeenCalledTimes(1);
  });

  test("the provider not answering is recorded as a warning, never an alerting error; no key still is one", async () => {
    const fails = async (fetchImpl, text = "Testbed") => geoapify.searchPlaces(text, { apiKey: "k", fetchImpl }).catch((e) => e);
    expect(await fails(jest.fn().mockRejectedValue(timedOut()))).toMatchObject({ code: "MAPS_UNAVAILABLE", severity: "warning" });
    expect(await fails(answer([], 401), "Testbed Close")).toMatchObject({ code: "MAPS_UNAVAILABLE", severity: "warning" });
    const notJson = jest.fn(async () => ({ ok: true, status: 200, json: async () => JSON.parse("<html>") }));
    expect(await fails(notJson, "Testbed Way")).toMatchObject({ code: "MAPS_UNAVAILABLE", severity: "warning" });
    const off = await geoapify.searchPlaces("Testbed", { apiKey: "", fetchImpl: answer([]) }).catch((e) => e);
    expect(off.code).toBe("MAPS_OFF");
    expect(off.severity).toBeUndefined();
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

describe("the nearest place to a point", () => {
  test("the provider's place at the point, asked for by its coordinates", async () => {
    const fetchImpl = answer([{ place_id: "n1", formatted: "12 Testbed Road, Lagos", lat: 6.4321, lon: 3.4219, result_type: "building" }]);
    expect(await geoapify.nearest(6.4321, 3.4219, { apiKey: "k", fetchImpl })).toMatchObject({ place_id: "n1", formatted: "12 Testbed Road, Lagos", kind: "building" });
    const url = fetchImpl.mock.calls[0][0];
    expect(url.searchParams.get("lat")).toBe("6.4321");
    expect(url.searchParams.get("lon")).toBe("3.4219");
    expect(url.searchParams.get("type")).toBeNull();
    expect(await geoapify.reverseGeocode(6.4321, 3.4219, { apiKey: "k", fetchImpl })).toBe("12 Testbed Road, Lagos");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("at level city, the city round the point", async () => {
    const fetchImpl = answer([]);
    await geoapify.nearest(7.3775, 3.947, { level: "city", apiKey: "k", fetchImpl });
    expect(fetchImpl.mock.calls[0][0].searchParams.get("type")).toBe("city");
  });

  test("null when the provider knows no place there, and that is remembered too", async () => {
    const fetchImpl = answer([]);
    expect(await geoapify.nearest(0.5, 0.5, { apiKey: "k", fetchImpl })).toBeNull();
    expect(await geoapify.nearest(0.5, 0.5, { apiKey: "k", fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("a point off the globe is refused before anyone is asked; no key is 503", async () => {
    const fetchImpl = answer([]);
    await expect(geoapify.nearest(95, 3, { apiKey: "k", fetchImpl })).rejects.toMatchObject({ status: 422 });
    await expect(geoapify.nearest(6.4, 3.4, { apiKey: "", fetchImpl })).rejects.toMatchObject({ code: "MAPS_OFF" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/** A database that answers each statement in turn and keeps what it was asked. */
function fakeDb(...answers) {
  const asked = [];
  return {
    asked,
    query: jest.fn(async (sql, params) => {
      asked.push({ sql, params });
      return answers.length ? answers.shift() : { rows: [], rowCount: 0 };
    }),
  };
}

describe("keeping a place", () => {
  test("every address field is in the registry, at a level", () => {
    expect(owners.OWNERS.map((o) => o.name).sort()).toEqual([
      "attendance_field_site.address",
      "attendance_home.address",
      "attendance_location_request.address",
      "employee.home_address",
      "organisation.address",
      "worksite.address",
    ]);
    for (const o of owners.OWNERS) expect(c.maps.PlaceLevel.options).toContain(o.level);
    expect(() => owners.get("employee.address")).toThrow(/no address field/);
  });

  test("the line is the details first, then the address; a waiting location reads Near", () => {
    expect(places.lineOf({ ...PICK, details: "Flat 3, blue gate" })).toBe("Flat 3, blue gate, 12 Testbed Road, Ikeja, Lagos");
    expect(places.lineOf({ ...PICK, details: null })).toBe("12 Testbed Road, Ikeja, Lagos");
    expect(places.lineOf({ source: "device", formatted: null, lat: 6.4321, lon: 3.4219, details: "Gate 2" })).toBe("Gate 2, Near 6.43210, 3.42190");
  });

  test("a pick is kept for its record and field, and its line handed back", async () => {
    const db = fakeDb({ rows: [{ place_id: "pl-1" }] });
    const saved = await places.save(db, "worksite.address", "w-1", { ...PICK, details: "Gate 2" });
    expect(saved).toEqual({ line: "Gate 2, 12 Testbed Road, Ikeja, Lagos", place_id: "pl-1" });
    const [{ sql, params }] = db.asked;
    expect(sql).toMatch(/ON CONFLICT \(owner, owner_key\) DO UPDATE/);
    expect(params.slice(0, 7)).toEqual(["worksite.address", "w-1", "search", PICK.formatted, "Gate 2", PICK.lat, PICK.lon]);
  });

  test("a pick too coarse for its field is refused on the field; a pin of any kind is a point and kept", async () => {
    const town = { ...PICK, formatted: "Ikeja, Lagos", kind: "area" };
    const err = await places.save(fakeDb(), "employee.home_address", "e-1", town).catch((e) => e);
    expect(err).toMatchObject({ code: "VALIDATION_FAILED", status: 422, fields: { home_address: ["Pick a street or building"] } });
    const onSite = await places.save(fakeDb(), "attendance_field_site.address", "s-1", town, { field: "sites.1.address" }).catch((e) => e);
    expect(onSite.fields).toEqual({ "sites.1.address": ["Pick a street or building"] });
    const db = fakeDb({ rows: [{ place_id: "pl-2" }] });
    await expect(places.save(db, "employee.home_address", "e-1", { ...town, source: "pin" })).resolves.toMatchObject({ place_id: "pl-2" });
  });

  test("an address field the registry does not hold is refused before anything is written", async () => {
    const db = fakeDb();
    await expect(places.save(db, "employee.work_address", "e-1", PICK)).rejects.toThrow(/no address field/);
    expect(db.query).not.toHaveBeenCalled();
  });

  test("an edit form reads the place back with a fresh token that saves it as it came", async () => {
    const row = { ...PICK, place_id: "pl-1", owner_key: "w-1", details: "Gate 2", accuracy_m: null };
    const view = await places.view(fakeDb({ rows: [row] }), "worksite.address", "w-1");
    expect(view).toMatchObject({ formatted: PICK.formatted, details: "Gate 2", source: "search", kind: "building", verified: true, pending: false });
    expect(c.maps.PlaceView.safeParse(view).success).toBe(true);
    const back = parse({ token: view.token, details: view.details });
    expect(back.success).toBe(true);
    expect(back.data).toMatchObject({ ...PICK, details: "Gate 2" });
    expect(await places.view(fakeDb(), "worksite.address", "w-2")).toBeNull();
  });
});

describe("naming what was saved while search was down", () => {
  const waiting = { place_id: "pl-9", owner: "worksite.address", owner_key: "w-9", details: "Gate 2", lat: 6.4321, lon: 3.4219 };
  const rename = jest.fn(async () => undefined);
  beforeAll(() => owners.owner("worksite.address", { rename }));
  beforeEach(() => rename.mockClear());

  test("each place is named, its owner's line rewritten by the owner, and place.named raised", async () => {
    const pool = fakeDb({ rows: [waiting] });
    const client = fakeDb({ rowCount: 1 });
    const emit = jest.fn(async () => undefined);
    const nearest = jest.fn(async () => ({ place_id: "n", formatted: "12 Testbed Road, Lagos", lat: 6.4321, lon: 3.4219, kind: "building", city: "Lagos", state: null, country_code: "ng" }));
    const done = await places.nameWaiting({ pool, nearest, tx: (fn) => fn(client), emit });
    expect(done).toEqual({ named: 1, stopped: false });
    expect(nearest).toHaveBeenCalledWith(6.4321, 3.4219);
    expect(client.asked[0].params).toEqual(["pl-9", "12 Testbed Road, Lagos", "n", "building", "Lagos", null, "ng"]);
    expect(rename).toHaveBeenCalledWith(client, "w-9", "Gate 2, 12 Testbed Road, Lagos");
    expect(emit).toHaveBeenCalledWith(client, expect.objectContaining({ key: "place.named", entity: { type: "place", id: "pl-9" }, payload: { owner: "worksite.address" } }));
    expect(JSON.stringify(emit.mock.calls[0][1])).not.toContain("6.43");
  });

  test("the first failure stops the run: an outage costs one request", async () => {
    const pool = fakeDb({ rows: [waiting, { ...waiting, place_id: "pl-10", owner_key: "w-10" }] });
    const nearest = jest.fn(async () => {
      throw Object.assign(new Error("down"), { code: "MAPS_UNAVAILABLE" });
    });
    const tx = jest.fn();
    expect(await places.nameWaiting({ pool, nearest, tx, emit: jest.fn() })).toEqual({ named: 0, stopped: true });
    expect(nearest).toHaveBeenCalledTimes(1);
    expect(tx).not.toHaveBeenCalled();
  });

  test("a point the provider knows no name for is named by its coordinates", async () => {
    const client = fakeDb({ rowCount: 1 });
    await places.nameWaiting({ pool: fakeDb({ rows: [waiting] }), nearest: async () => null, tx: (fn) => fn(client), emit: jest.fn() });
    expect(rename).toHaveBeenCalledWith(client, "w-9", "Gate 2, 6.43210, 3.42190");
  });

  test("a place changed meanwhile is left as its new save made it", async () => {
    const client = fakeDb({ rowCount: 0 });
    const emit = jest.fn();
    const done = await places.nameWaiting({ pool: fakeDb({ rows: [waiting] }), nearest: async () => null, tx: (fn) => fn(client), emit });
    expect(done).toEqual({ named: 0, stopped: false });
    expect(rename).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
