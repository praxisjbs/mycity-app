import type { Place } from "@mycity/contract/contract.gen.ts";
import { fold, invalid, ok, route } from "../core";
import { WORKSITES } from "./worksites";

/**
 * The address search on the mock (packages/contract/schemas/maps.js): a short list of
 * invented Lagos places, each word of the text matched anywhere in the address, at most
 * six, as the API answers. Nothing is asked of a provider.
 */
const STREETS: Array<[string, number, number]> = [
  ["12 Admiralty Way, Lekki Phase 1, Lagos", 6.4321, 3.4219],
  ["4 Admiralty Road, Lekki Phase 1, Lagos", 6.4338, 3.4255],
  ["Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", 6.6142, 3.3578],
  ["Oba Akran Avenue, Ikeja, Lagos", 6.6018, 3.3515],
  ["Creek Road, Apapa, Lagos", 6.4474, 3.3595],
  ["Landmark Centre, Water Corporation Drive, Victoria Island, Lagos", 6.4229, 3.4501],
  ["Eko Convention Centre, Victoria Island, Lagos", 6.4253, 3.4074],
  ["Herbert Macaulay Way, Yaba, Lagos", 6.5095, 3.379],
  ["Allen Avenue, Ikeja, Lagos", 6.6005, 3.3545],
  ["Bourdillon Road, Ikoyi, Lagos", 6.4521, 3.4339],
];

const PLACES: Place[] = [
  ...WORKSITES.map((w) => ({ place_id: `site-${w.code}`, formatted: w.address ?? w.name, lat: w.latitude, lon: w.longitude })),
  ...STREETS.map(([formatted, lat, lon], i) => ({ place_id: `street-${i}`, formatted, lat, lon })),
];

route("GET /api/v1/maps/search", (req) => {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 3) return invalid({ "query.q": ["Type three letters"] });
  const words = fold(q).split(/[\s,]+/).filter(Boolean);
  const places = PLACES.filter((p) => words.every((w) => fold(p.formatted).includes(w))).slice(0, 6);
  return ok({ places });
});
