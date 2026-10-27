# Addresses · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M0 (foundation, decided by TB on 20/10/2026; extends F21) |
| Backend modules | `maps` (the address search, the pin, the `place` table and its naming job) |
| Frontend paths | `app/src/features/shared/places.ts` |
| Permission key(s) | none of its own: searching, pinning and the map are open to everyone signed in (`self`); each form's save checks its own module's grant |
| Capabilities | none |
| Screens (PROGRESS.md rows) | every screen in §2 (#69, #28, #25, #87, #9, #8, #24, #38, #51, #53) and the M0 item "Addresses picked, never typed" |
| Status | Agreed |
| Last changed | 22/10/2026 |

Sources: TB's brief and four answers of 20/10/2026 (§1.1); FRONTEND_FOUNDATION F21 (maps) and F27
(this rule); `foundation.md` §6.13 (the address search as first built); `integrations.md` (the
Geoapify key, its daily limit and its use); `attendance.md` §6.10 (a home's fence).

---

## 1 · What it is for

Every address a person enters anywhere in the ERP is **picked, never typed**: on the staff app
(`hub.mycityapp.io`) and the public site (`go.mycityapp.io`), on production and on staging. A
field suggests real places from the first characters, and what is kept is the place picked: its
line, its point, its kind and the provider's id. So every stored address is somewhere a map can
show, a fence can be drawn round, a letterhead can print and a report can group by city, and two
people never spell the same street two ways.

The rule holds in three places, so no path around it exists: the field (`AddressField`, and
`PlacesField` for a list of cities) has no free-text mode; the API accepts only a place our own
search or pin signed (§6.2); and CI fails a screen or a contract that asks for an address any other
way (gate 22, §6.10).

### 1.1 Decisions (TB, 20/10/2026, binding)

| # | Question | Answer |
|---|---|---|
| 1 | Which fields | Every field across the ERP where an address is entered, on hub and go, live and staging. No free field. The convention is written where every contributor reads it (CLAUDE.md Step 4, README §7, FRONTEND_FOUNDATION F27) |
| 2 | Nothing found | **Landmark plus details**: the person picks the nearest street or landmark that is found, and an optional Details line under it takes the house number, the flat or directions. Only the picked place is the address. **And Pin on the Map**: a map opens, they tap the spot, and the nearest named address is taken from that point |
| 3 | Speed | **Instant, credit-aware**: searching starts at the second character, about 100 ms after the last key; answers are kept on the device and on the server, so backspacing or retyping shows results at once and costs nothing; a request overtaken by newer typing is cancelled |
| 4 | Address search down or out of credits | The field says address search is unavailable, with Try Again, and a new row appears under it: **Use Current Location**. The device's location stands in for the address and is named once search is back. The rest of the form stays filled. An optional address may be left empty; a form that requires one waits |
| 5 | The public site | **Ready, not built**: go has no address field today. The rule and the shared field cover it; its public, rate-limited search is built with go's first form that asks for an address |

Following from them, decided while designing (TB to confirm, §13):

- **Addresses typed before this rule** stay as they are, marked Unverified, and are re-picked the
  next time the address is changed. Nothing is cleared or guessed.
- **What reaches the provider**: the text a person types into an address field, a point they pin,
  and the device's location they chose to give as an address. A clock-in's point is never sent,
  and no screen labels a punch with an address (`foundation.md` §6.13, 19/10/2026, still holds for
  punches). This widens the 19/10 rule, which sent only a worksite's centre, because answers 2 and
  4 ask the provider to name a point the person chose.

---

## 2 · Screens affected

Every place an address is entered today. The level (§6.3) is what a pick may be.

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Settings · Organisation (`organisation`, #69) | Staff app | `settings` view, edit | **Address** (level address): the company's, printed on letterheads, PDFs, system mail and signatures | Pick the address, add details, drop a pin |
| People · Worksites (`worksites`, #28) | Staff app | `people` create, edit | **Address** (address, optional) beside the fence's centre and radius; a pick fills the centre, and a centre typed or tapped first fills an empty address from the pin | Pick, pin, or let the centre name it |
| Add Work Site, the temporary site sheet (Home · Overview #1, ESS · Work Location Requests #87; Add Temporary Site on People · Worksites #28) | Staff app, both shells | Anyone; People for Add Temporary Site | **Addresses**, one to eight (address); each pick is the address's fence centre, with its own radius and small map | Pick, pin, add details; Add Address, Remove |
| People · Attendance, Field Assignments, and ESS · Work Location Requests, New Request | Staff app | Until attendance's PR 4 | A field site's and a client visit's or temporary home's address; both forms went in PR 4, their saved addresses kept | None now |
| ESS · My Attendance, Home Location (`my-attendance`, #9) | Staff app, both shells | The person, while the Attendance policy's Home Location is on (`attendance.md` §1.3) | **Address** of the home they ask to clock in from (address, required). The fence stays on the reading taken at home | Pick, pin, add details, or use the current location in an outage |
| ESS · My Profile, Edit Profile (`my-profile`, #8) | Staff app, both shells | The person | **Home Address** (address, optional) | Pick, pin, add details |
| People · Employees (`employees`, #24) | Staff app | `people` view; the address under the `employee.personal` mask | The home address on the record, read only. The add and edit forms do not ask for it; the person sets it on My Profile | Read it |
| Recruitment · Vacancies (`vacancies`, #38, M4, on the mock) | Staff app | `recruitment` create | **Location** of a vacancy (level area: a district or a city) | Pick an area |
| Partnerships · Partners (`partners`, #51, M7, on the mock) | Staff app | `partnerships` create | **Headquarters** of a partner (area) | Pick an area |
| Partnerships · Proposals (`proposals`, #53, M7, on the mock) | Staff app | `partnerships` create | **Cities** a proposal runs in (level city, one or more) | Pick each city |
| Every go page (Careers, Apply, Sign Offer, Verify) | Public site | Anyone | No address field today (decision 5) | Nothing to change |

Not an address entered, so outside the rule and marked `address:none` in the code: the Address on
Settings · Integrations, Geoapify (the text Test searches with, never kept). Addresses are read,
never entered, on the worksite list, the employee record, People · Attendance's homes and the
clock-in line.

## 3 · How the screens relate

1. **Typing.** From the second character, about 100 ms after the last key, the field asks
   `GET /maps/search?q=&level=` (our API; the key never reaches a browser). While that is on its way
   the field shows, at once, the places it already holds that still match every word typed (the
   device keeps each answer for the session), and a newer key cancels the request it overtakes.
2. **The server** answers from memory (this process, ten minutes), then from Redis (shared by the
   API processes, seven days), then from Geoapify's autocomplete, biased to Lagos and Nigeria, never
   filtered. Each place comes back with its line, point, kind and a **token**: our signature over all
   of it (§6.2). Two people typing the same text at once cost one request.
3. **Picking.** The field holds the token (which carries the line, the point and the kind) and the
   Details line, exactly the contract's `PlaceInput`, and shows the address with Change. At level
   address a **Details** line opens under it (optional, 120 characters). Where the form keeps a
   point of its own (a worksite's centre, a field site, a client visit), the pick fills it too.
4. **Nothing found.** The list says so ("No address found", "Try a nearby landmark or street.").
   **Drop a Pin** sits under the search box throughout: the map opens in the field, at the form's own
   point where it has one; a tap asks `GET /maps/pin?lat=&lon=&level=` (the point at six places, as
   `place` keeps it), which names the nearest address and signs it with the tapped point kept as
   the point (source pin).
5. **Address search down** (no key, the provider refusing or silent, or the day's credits spent):
   the field says "Address search is unavailable", with Try Again, and shows **Use Current
   Location**. The device's reading (its accuracy shown) becomes the address, saved as waiting to
   be named (source device). The `places-name` job names it once search answers again (§7).
6. **Saving.** The form sends `{ token, details }`, or `{ device, details }` in an outage. The
   contract checks the token's signature at the edge, so a typed or altered address is a 422 on the
   field ("Pick an address") before any service runs. The owning module's service then calls
   `places.save()` in its own transaction: one `place` row for that record's field, and the
   module's own readable line (details first, then the address), which its lists, exports, masks,
   letterheads and search read as before.
7. **Editing.** A record opened for editing carries `<field>_place` with a fresh token, so an
   address left alone goes back exactly as it came, and a changed Details line saves without a new
   search.
8. **Addresses typed before the rule** are `place` rows of source typed, unverified. The field
   shows them with an Unverified pill; they are kept until the address is changed, and a change
   must be a pick.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `place` (`0490`, new) | `place_id`, `owner` (which field of which table: `employee.home_address`, `worksite.address`, ... §6.9), `owner_key` (the record's id, or `organisation`), `source` (`search`, `pin`, `device`, `typed`), `formatted` (the provider's line; null while a device location waits), `details`, `lat`, `lon` (`numeric(9,6)`; null only for an address typed before the rule), `accuracy_m` (device), `provider_id`, `kind` (`building`, `street`, `landmark`, `area`, `city`, `region`, `country`, `unknown`), `city`, `state`, `country_code`, `verified`, `pending`, `named_at`, `created_at`, `updated_at`; unique on `owner`, `owner_key` | One row per address field of a record, replaced when the address changes. The owner keeps its own readable line column (`employee.home_address`, `worksite.address`, ...), so nothing that reads an address changed. A home's or a request's personal data is read only through its owner's service, under its mask |

`0490` also fills `place` from every address already saved (source typed, unverified, the record's
own point where it has one). No seed: places are never demonstration data (A26).

**A place's time zone** (TB, 20/10/2026, for attendance's temporary sites, attendance.md §6.4): the
provider's `timezone.name` on a search or pin answer (Geoapify's result field, recorded in
`src/modules/maps/maps.test.js`) is kept by `toPlace` when it is a zone the runtime knows, and travels
in the token (§6.2). `place` keeps no time zone and gains no column: an owner that needs one keeps it
in its own row (`attendance_temporary_site_location.timezone`), read from the parsed `PlaceInput`
when the address is saved, Africa/Lagos when the place has none (the device's location while search
is down, a token signed before the zone was kept, a place read back from `place` for an edit form).

Schema migration file(s): `migrations/0490_place.sql`. Reference-data file(s): none.

## 5 · API

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /maps/search` | `PlaceSearchQuery` (`q` 2 to 200 characters, `level`) → `PlaceMatches` | signed in (`self`) | no: at most six suggestions, the provider's answer to one search | Each place signed (`token`), with its kind |
| `GET /maps/pin` | `PinQuery` (`lat`, `lon`, `level`) → `Place` | signed in (`self`) | | The nearest named address, signed, with the tapped point kept. Replaces `GET /maps/reverse` |
| `GET /maps/tiles/:z/:x/:y.png` | `TileParams` → a PNG | signed in (`self`) | | Unchanged |
| Every write that carries an address | the field is `PlaceInput`: `{ token, details }` or `{ device: { lat, lon, accuracy_m }, details }` | the owning route's | | 422 "Pick an address" for a missing, typed or altered token |
| Every read an edit form opens | the address line as before, plus `<field>_place` (`PlaceView`, with a fresh token) | the owning route's | | `PlaceView` only where a form edits the address: Settings · Organisation, a worksite, My Profile |

The write fields: `OrganisationPatch.address` and `WorksiteUpdate.address` (null clears them),
`WorksiteCreate.address`, `TemporarySiteCreate.locations[].address` (attendance's PR 4, which retired
`FieldSiteInput.address` and `LocationRequestCreate.address` with their create routes),
`HomeRequestCreate.home_address`, and `EssProfileUpdate.home_address`, `EmployeeCreate.home_address`
and `EmployeeUpdate.home_address` (left out, the address stays; nothing clears a home address).
Recruitment and Partnerships take `PlaceInput` the day their contracts land (gate 22 holds them to
it).

## 6 · Rules and calculations

### 6.1 Three ways in, and no fourth

An address is a place **picked** from the search, a place **pinned** on the map, or, only while
address search is down, the device's **current location**. Typing finds; it never becomes the
address. The Details line is the one free text, and it is never searched, never geocoded and never
the address on its own: it is printed before the address (`Flat 3, blue gate, 12 Admiralty Way,
Lekki Phase 1, Lagos`).

### 6.2 The token

- `p1.<payload>.<signature>`: the payload is the place as our API found it (source, line, point,
  provider id, kind, city, state, country, verified, pending, accuracy, and its time zone when the
  provider named one, `tz`, optional, so a token signed before it still verifies), base64url JSON; the
  signature is HMAC-SHA256 over it, cut to 128 bits, with a key derived from `ENCRYPTION_KEY`
  (HKDF, info `place-token v1`). No new secret, and each environment's tokens are its own.
- Made only by our API: a search answer, a pin, and a read for an edit form. A browser cannot make
  one, so a typed or altered address cannot reach a service.
- Checked at the edge: `PlaceInput`'s refinement asks the verifier the server installs
  (`src/shared/places/token.js`, installed by `src/app.js`). Without one, a Node process refuses
  every token (fail closed); a browser checks the shape only.
- No expiry: it proves where the place came from, not when. A changed `ENCRYPTION_KEY` invalidates
  open forms, which then ask for the address again.

### 6.3 Levels

| Level | Fields | A pick may be | The search asks for |
|---|---|---|---|
| `address` | Organisation, worksite, field site, request, home, profile | a building, a street or a landmark | everything, coarse results dropped |
| `area` | A vacancy's location, a partner's headquarters | anything from a building to a city | everything, regions and countries dropped |
| `city` | A proposal's cities | a city or a town | cities only |

A pin at level address keeps the tapped point and names it with the nearest street or building;
at level city it names the city around it.

### 6.4 Speed

| Where | What |
|---|---|
| Field | Searches from the 2nd character, 100 ms after the last key; cancels the request a newer key overtakes; shows at once the places held for an earlier, shorter text that still match every word; keeps each answer for the session (200 texts); keeps the list on screen while a new answer comes, so it never flickers empty; asks a failed search or pin once more after 400 ms, so one blip never shows |
| Server | This process's memory (ten minutes, 500 texts), then Redis (seven days), then the provider; one request for the same text typed at once; at most five requests a second to the provider (its free plan's rate), a sixth waiting up to 300 ms; a dropped connection (closed, reset, refused, a failed lookup) asked once more at once, never a request that ran out of its 4.5 seconds |
| Credits | A search or a pin is one credit; an answer from memory or Redis is none. About 4 to 6 credits an address typed. Counted on Settings · Integrations, Geoapify, against its daily limit |

### 6.5 When address search is down

- Down means: no key (503 `MAPS_OFF`), the provider failing or silent (502 `MAPS_UNAVAILABLE`), or
  over the day's credits or our rate (429 `MAPS_BUSY`), twice running: the field asks a failed
  search or pin once more after 400 ms before it calls search down (fault #1, 20/10/2026).
- The provider failing or silent is its outage, not a defect of ours: System Health counts it as a
  `warning`, which never alerts or escalates, while Settings · Integrations and the `maps`
  readiness check carry the outage itself (`system-health.md` §6). No key stays an `error`.
- The field keeps whatever the person typed in its box, says "Address search is unavailable", and
  offers Try Again and Use Current Location. Pin is hidden: the map's tiles come from the same
  provider.
- Use Current Location asks the device for a reading (high accuracy, 15 seconds). The field shows
  "Current location, within 12 m" ("Current location, approximate" past 200 m). Saved, it is a
  `place` of source device, `pending`, with the readable line `Near 6.43210, 3.42190` until named.
- The `places-name` job names every waiting place once search answers: the nearest address
  becomes its line (details first), `pending` clears, and the owner's line is rewritten by the
  owner's own code (§6.9).

### 6.6 Addresses typed before the rule

`0490` gives each saved address a `place` row of source typed, unverified, with the record's own
point where it has one (a worksite's centre, a field site, a request's site). The field shows it
with an Unverified pill; an edit that leaves it alone keeps it (its token says typed); a change is
a pick. Nothing is cleared, and nothing is geocoded behind anyone's back.

### 6.7 Privacy

The provider receives what a person types into an address field, a point they pin, and a device
location they chose to give as an address (§1.1). A clock-in's point is never sent and no screen
labels a punch. A home's place is personal data: read only through its owner's service, under
`employee.personal`, like the line beside it.

### 6.8 Each environment

Production and staging each use their own Geoapify key from their own Settings · Integrations,
with their own daily limit and counts; tokens made on one never verify on the other. The rule and
the field are the same on both, and on go when it first needs them.

### 6.9 Owners

Each address field is an **owner** in `src/shared/places/owners.js`: its name (`employee.home_address`),
the module that holds it, whether it is personal, and its level. The holding module registers in
its `*.events.js` how its readable line is rewritten (`places.owner(name, { rename })`), so the
naming job writes another module's row only through that module's code. A new address field is a
new owner, a `PlaceInput` in its contract, `places.save()` in its service, and `AddressField` on
its screen; gate 22 refuses any of the four missing.

### 6.10 The rule in CI (gate 22, `scripts/check/addresses.js`)

- Every request body field named like an address (`address`, `home_address`, `location`, `hq`,
  `headquarters`, `venue`, `cities`, ending `_address`) is a `PlaceInput`, or a list of them.
- Every `PlaceInput` field belongs to a registered owner.
- In `app/src`, `public-app/src` and `packages/ui/src`, a field labelled like an address, or bound
  to such a form field, is an `AddressField` or a `PlacesField`. A deliberate exception carries
  `address:none <reason>` on the line or the line above.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `places-name` (scheduler, every 5 minutes, worker) | A place waits to be named | Names up to 25 waiting places a run (`-- pagination:batch`), stops at the first failure so an outage costs one request, and rewrites each owner's line through the owner's own code |
| `place.named` | A waiting place was named | Audit: the owner and record, never the point |

No notification: a named address changes nothing a person must act on.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Everyone signed in | Suggestions, pins and the map | Search, pin and see tiles (`self`); save only where their own module's grant allows |
| The person | Their own home and requests | Pick, pin, use the current location in an outage |
| People with scope all | Homes and requests under `employee.personal` | As their module allows |

No permission key of its own; the restricted field is the home's line and place, masked by the
owner (§6.7).

## 9 · AI and search

- **AI reads**: none (`// ai:none` in `maps.controller.js`): an address is read through its
  owner's manifest, masked as there.
- **AI routes**: none.
- **Search**: `place` is `search:none`: a place is found through the record that holds it.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Every address field (`AddressField`) | The field's own label; the typed text; up to six suggestions, each with a glyph for its kind and its line; Searching while an answer comes; Drop a Pin under the search box; the picked address in the field with Change (Keep Address while changing; Clear Address where the field is optional); Details (Optional) under it at level address, placeholder "Flat 3, blue gate"; an Unverified pill on an address typed before the rule; "No address found" with "Try a nearby landmark or street."; errors "Pick an address", "Pick a street or building" | Help term on Unverified: "Typed before addresses were picked. Pick it again to confirm." Help term on Details: "House number, flat or directions. Printed before the address." | Tokens, levels, caches, credits, the naming job: §3, §6 |
| Drop a Pin (in the field) | The map, interactive, with "Tap the spot"; the pinned address once named; Use This Address, Cancel | Nothing | How a pin is named: §3 step 4 |
| Address search down (in the field) | "Address search is unavailable"; Try Again; Use Current Location; "Location blocked" or "Location not found" when the device gives none; once read, "Current location, within 12 m" (or "Current location, approximate"); after saving, the line reads "Near 6.43210, 3.42190" until named | Help term on Current Location and on Near: "Named once address search is back." | The outage rules and the job: §6.5, §7 |
| A list of cities (`PlacesField`) | Each city picked as a chip with Remove; the field to add another, with suggestions; "No place found"; "Address search is unavailable" with Try Again; "Pick a city" | Nothing | Levels: §6.3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Every address field (`AddressField`) | The field at 44 px with 16 px text; suggestions under it as 44 px rows inside the sheet's own scroll, so the keyboard never hides them | Nothing | Tap a suggestion | Esc or tap elsewhere closes the list |
| Drop a Pin (in the field) | The map full width under the field, at the medium height, then Use This Address full width | Nothing | Use This Address | Cancel returns to the field |
| Address search down (in the field) | The message, Try Again and Use Current Location, each full width | Nothing | Use Current Location | Try Again searches again |
| A list of cities (`PlacesField`) | The chips wrapping, then the field | Nothing | Tap a suggestion to add it | Remove on a chip |

## 11 · Edge cases

- **The street is not on the map** (new estates, unnamed roads): pick the nearest landmark or street
  and put the rest in Details, or drop a pin; the pin keeps its own point.
- **The pin is in open country**: the nearest named place may be far; the pin's point is kept and
  the line says the nearest place the provider knows.
- **A person types and leaves without picking**: the field shows the address it held before (or
  nothing), and a required field says "Pick an address" on save.
- **The provider changes a line later**: a saved place keeps the line it was picked with; it is
  never updated behind anyone's back.
- **Two records at one address** (two people, one house) are two `place` rows, each its owner's.
- **A device location in an outage is far from the address** (the person is not there): its line
  names where they stood; they change it with a pick once search is back.
- **Location permission refused** in an outage: the field says Location blocked and keeps Try
  Again; a required address waits.
- **Credits run out mid-morning**: suggestions stop with the outage message; Settings ·
  Integrations has warned IT at 80% (`integrations.md` §6.9).
- **A form open across a key change** (`ENCRYPTION_KEY` rotated): its token no longer verifies;
  the field asks for the address again.
- **The mock** signs nothing: its tokens are plain encodings the mock alone accepts, and it never
  ships (F12 to F14).

## 12 · Donor code

None.

## 13 · Open questions

1. **Addresses typed before the rule** (§6.6): kept and marked Unverified until changed. TB to
   confirm, or choose a one-off re-pick prompt for each person instead.
2. **go's public search** (decision 5): built with go's first address field, as a public route with
   its own rate limit per visitor and its own credit budget.
3. **A paid Geoapify plan** if the free plan's 3,000 credits a day prove short once every address
   field searches per keystroke.

## 14 · Change log

- 27/10/2026 · JP · From the 27/10 staging faults brief (fault #3, `VALIDATION_FAILED: query.lat, query.lon` at `GET /api/v1/maps/pin`): a tap on the map carries Leaflet's full precision (6.452871234567891), and the hub sent it as written, which `PinQuery` refuses past ten places, so a pin named nothing. The hub's `places.pin` now sends six places (`degreesOf`), about 10 cm, what `place.lat` keeps (§3 step 4, §5). The contract is unchanged.
- 22/10/2026 · TB · My Attendance's Home Location address is asked for only while the Attendance policy's Home Location is on (`attendance.md` §1.3); the residential Home Address on My Profile and the employee record is unchanged.
- 20/10/2026 · TB · Written from TB's brief and four answers (§1.1): every address across the ERP
  picked, never typed, on hub and go, live and staging, with the inventory (§2), the signed place
  (§6.2), the instant search (§6.4), the outage path (§6.5) and gate 22.
- 20/10/2026 · TB · Built (§2 to §10): `place` (`0490`) with the backfill, the signed token, the owners
  registry, `places.save`, `view` and the naming job; `GET /maps/pin` in place of `/maps/reverse`; the
  search from the second character with the server's memory, Redis and rate; every write field above
  a `PlaceInput`; `AddressField` rebuilt (Change, Keep Address, Clear Address, Details, Unverified,
  Drop a Pin under the search, the outage with Use Current Location), `PlacesField`, the device's
  session cache and cancelled requests (`usePlaces`); every screen in §2 moved; gate 22. Drop a Pin
  stays under the search throughout rather than only when nothing is found (§3 step 4, §10.1).
- 20/10/2026 · TB · Fault #1 (staging: "Maps are not answering." once on `GET /maps/search`; the provider gave no answer within 4.5 seconds or the connection dropped; TB's four answers): a dropped connection is asked once more at once on the server, never a timeout, and its network code is logged; the field asks a failed search or pin once more after 400 ms before it calls search down; the provider not answering is recorded on System Health as a `warning`. §6.4, §6.5 updated.
- 20/10/2026 · TB · A place's time zone (§4, §6.2), for attendance's temporary sites (attendance.md §6.4): `toPlace` keeps the provider's `timezone.name` when the runtime knows the zone, the token carries it as an optional `tz` (tokens signed before still verify), and the owner keeps it in its own row; `place` gains no column. A new owner, `attendance_temporary_site_location.address` (§6.9), in place of the field site's and the work location request's for new entries (both kept for the records already saved).
