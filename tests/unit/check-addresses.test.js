"use strict";
/**
 * Gate 22, addresses are picked, never typed (scripts/check/addresses.js, F27). Both halves are
 * pure over what they are given, so the edges are pinned here: what counts as an address field
 * in a request body, and what a screen may put inside a Field labelled like one.
 */
const { z } = require("zod");
const c = require("@mycity/contract");
const { addressFields, screenProblems } = require("../../scripts/check/addresses");

const P = c.maps.PlaceInput;
const whats = (src) => screenProblems(src).map((p) => p.what);

describe("the contract half", () => {
  test("an address typed as text is found; a PlaceInput, optional, nullable or in a list, passes", () => {
    const body = z
      .object({
        name: z.string(),
        address: z.string(),
        home_address: P.optional(),
        sites: z.array(z.object({ address: P.nullable() })),
        cities: z.array(P),
        email: z.string(),
      })
      .strict();
    expect(addressFields(body, P)).toEqual([
      { key: "address", at: "body.address", place: false },
      { key: "home_address", at: "body.home_address", place: true },
      { key: "address", at: "body.sites[].address", place: true },
      { key: "cities", at: "body.cities", place: true },
    ]);
  });

  test("every name a place goes by is an address field: hq, venue, city, ending _address or _location", () => {
    const body = z.object({ hq: z.string(), venue: z.string(), city: z.string(), billing_address: z.string(), event_location: z.string(), sender: z.string() });
    expect(addressFields(body, P).map((f) => f.key)).toEqual(["hq", "venue", "city", "billing_address", "event_location"]);
  });

  test("it looks through refinements and stops inside a PlaceInput", () => {
    const body = z.object({ address: P }).refine(() => true);
    expect(addressFields(body, P)).toEqual([{ key: "address", at: "body.address", place: true }]);
  });
});

describe("the screen half", () => {
  test("a Field labelled like an address must hold an AddressField or a PlacesField", () => {
    expect(whats(`<Field label="Headquarters"><TextField {...f.field("name")} /></Field>`)).toEqual([
      '"Headquarters" is a TextField, not an AddressField or a PlacesField',
    ]);
    expect(whats(`<Field label="Home Address" optional {...f.status("home_address")}><AddressField {...f.field("home_address")} places={places} /></Field>`)).toEqual([]);
    expect(whats(`<Field label="Cities"><PlacesField {...f.field("cities")} places={places} /></Field>`)).toEqual([]);
  });

  test("a control bound to a form field named like an address must be a picker, however it is labelled", () => {
    expect(whats(`<Field label="Where"><TextField {...f.field("hq")} /></Field>`)).toEqual(['TextField bound to "hq", an address; use AddressField or PlacesField']);
    expect(whats("<TextField {...f.field(`s${n}_address`)} />")).toEqual(['TextField bound to "s${n}_address", an address; use AddressField or PlacesField']);
  });

  test("an email, web or IP address is not a place", () => {
    expect(whats(`<Field label="Email Address"><TextField {...f.field("email")} /></Field>`)).toEqual([]);
    expect(whats(`<Field label="Web Address"><TextField {...f.field("website")} /></Field>`)).toEqual([]);
  });

  test("address:none with a reason, on the line or the line above, is a deliberate exception", () => {
    expect(whats(`// address:none the text a test searches once\n<Field label="Address"><TextField value={q} onChange={setQ} /></Field>`)).toEqual([]);
    expect(whats(`<Field label="Address"><TextField value={q} onChange={setQ} /></Field> {/* address:none a search box */}`)).toEqual([]);
    // The marker needs its reason.
    expect(whats(`// address:none\n<Field label="Address"><TextField value={q} onChange={setQ} /></Field>`)).toHaveLength(1);
  });
});
