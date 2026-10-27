import { afterEach, describe, expect, it, vi } from "vitest";
import maps from "@mycity/contract/schemas/maps.js";
import { api } from "@/api/client";
import { degreesOf, places } from "./places";

/**
 * The pin's query (docs/guides/addresses.md §5): a point tapped on the map reaches the API in a
 * shape the contract takes. Leaflet hands back a tap at full precision (6.452871234567891), and
 * `String()` of it was refused as query.lat and query.lon (fault #3 on staging, 27/10/2026).
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("places.pin", () => {
  it("sends a tapped point at six places, which the contract takes", async () => {
    const call = vi.spyOn(api, "call").mockResolvedValue({} as never);
    await places.pin({ lat: 6.452871234567891, lon: 3.3947123456789123 }, { level: "address" });
    const [key, init] = call.mock.calls[0]! as unknown as [string, { query: { lat: string; lon: string; level: string } }];
    expect(key).toBe("GET /api/v1/maps/pin");
    expect(init.query).toEqual({ lat: "6.452871", lon: "3.394712", level: "address" });
    expect(maps.PinQuery.safeParse(init.query).success).toBe(true);
  });

  it("never writes a point the contract refuses: a long tail, a tiny one, the far corners", () => {
    for (const [lat, lon] of [
      [6.452871234567891, 3.4000000000000004],
      [1e-7, -1e-7],
      [-89.99999999999, 179.99999999999],
    ] as const) {
      expect(maps.PinQuery.safeParse({ lat: degreesOf(lat), lon: degreesOf(lon) }).success).toBe(true);
    }
    // As the screen wrote it before, the contract refused it.
    expect(maps.PinQuery.safeParse({ lat: String(6.452871234567891), lon: String(1e-7) }).success).toBe(false);
  });
});
