"use strict";
/**
 * HOME_STAGING_ROWS: every id Home's staging seed writes, or once wrote, into a later
 * milestone's table, by table, children before parents (docs/guides/home.md §11). The ids are
 * written out here, not worked out from the rows, so taking a row out of lib/forward-rows.js
 * never takes its id off this list.
 *
 * The milestone that builds one of these tables, in the PR that adds its own staging seed:
 *
 *   1. has that seed call removeHomeStagingRows(client, [its tables]) inside its transaction,
 *      before it writes its own rows: the alerts Home raised about those rows are deleted, then
 *      the rows, children first;
 *   2. takes those tables' rows out of lib/forward-rows.js and leaves their ids here, so the call
 *      finds them on every staging database, whichever seed runs first;
 *   3. takes the figures those rows gave out of Home's seed tests.
 *
 * Run again, the call deletes nothing. The Home seed deletes them too: each run deletes the
 * listed rows it does not write (lib/forward-rows.js writeForwardRows).
 *
 * An alert about a row that is gone opens nothing and nobody can deal with it, so it goes with
 * the row. Each id is its row's table and key in the Home seed's namespace (lib/forward-rows.js
 * idOf); tests/unit/home-staging-seed.test.js holds every id here to that.
 */

/** The tables, children before parents: the order their rows are deleted in. */
const DELETE_ORDER = Object.freeze([
  "partner_interaction",
  "partnership_agreement",
  "partnership_proposal",
  "partnership_opportunity",
  "partner",
  "expense_request",
  "budget_line",
  "budget",
  "calendar_event",
  "task",
  "employee_target",
  "organisational_goal",
  "performance_review",
  "performance_cycle",
  "vacancy",
]);

/** Every id, by table and its row's key. */
const IDS = Object.freeze({
  partner_interaction: {
    "mtn-nigeria": "593be2b3-620b-5b77-95f7-a79b889080d9",
    "providusbank": "e0178ce4-38a5-57b2-b7a5-fc08df99ea69",
    "ikeja-city-mall": "a7b93305-e2da-55a8-85a2-420a79331f30",
    "lagos-state-government": "15ad179f-2060-5cf0-9c06-6ba17d7c607c",
  },
  partnership_agreement: {
    "mtn-nigeria": "d786cd39-8444-500b-9f28-f5d70d1f765c",
    "providusbank": "1ec83a76-d119-5f4b-8543-92cff128d710",
    "ikeja-city-mall": "9f571598-2734-508b-a344-4578664b144f",
    "access-bank": "93e5bfbc-740d-508a-8e02-a5bb3da55fbf",
  },
  partnership_proposal: {
    "lagos-state-government": "2d004ae7-de65-5b5e-8de9-090893c0795e",
    "eko-hotels": "438fb409-dfc6-52e1-8bd0-620dc33c95a4",
  },
  partnership_opportunity: {
    "lagos-state-government": "eaf0426b-471e-5c9b-8c9f-08f7b6ad7ffc",
    "eko-hotels": "a80d3b6d-49ec-5a56-9030-7958dd70cfe8",
    "filmhouse-cinemas": "ac711cf5-a9b2-51bb-ba09-b274572f80f3",
    "kano-trade-council": "1fc6834e-fef4-5066-8d13-0c1d5d17a8a6",
  },
  partner: {
    "mtn-nigeria": "c2c82fcf-6088-5999-9e6a-5a37a6e6739a",
    "providusbank": "2aa4db0a-8535-5088-a48a-806ece180f6d",
    "ikeja-city-mall": "3f411bbe-d960-5ccd-b303-46ab54473919",
    "access-bank": "4a0911b2-593b-58a3-a91d-0a4e2cbe987d",
    "lagos-state-government": "bdfe293e-6eff-58f0-8b89-9ef1a7e14f23",
    "eko-hotels": "5119bdd1-0f49-5511-b9d8-45e41dacb344",
    "filmhouse-cinemas": "6d494287-9b81-5e49-b389-cb920d75b750",
    "kano-trade-council": "fe61bfcf-88a9-5d71-8fa8-98e793caa9f7",
  },
  expense_request: {
    "printer-toner": "850188d8-f49e-5a03-906c-885b171e211a",
    "lagos-activation-transport": "6f1d7fda-1881-5079-964b-008681035382",
    "social-media-course": "4a4ba458-41c5-5e93-864d-968dd007ac72",
    "listing-team-data": "fbce5a39-ba4a-56eb-86a6-c7c618d21bf8",
    "enugu-launch-transport": "93e54bd0-c0ad-5682-a117-f324136d161b",
  },
  budget_line: {
    "operations-quarter:office": "959ec4c3-c5c2-53df-b730-68725b9898b1",
    "operations-quarter:utilities": "2ac5fe7a-1955-5ee0-aecc-d54c240d8c45",
    "marketing-quarter:travel": "3d5b2377-cf6b-5a84-8f40-40a44b6fa91d",
    "marketing-quarter:training": "93202085-4113-502c-8b19-5da3dc8f8051",
  },
  budget: {
    "operations-quarter": "6e3f16a5-37a5-5e65-920b-9b326d48820e",
    "marketing-quarter": "a000e84b-c8ca-5bef-8237-7fef928184f1",
  },
  calendar_event: {
    "management-meeting:ceo": "c20c37cd-b705-5186-96be-475cbd9c3996",
    "management-meeting:operations": "c32e0637-6320-527f-9346-e777f98f1998",
    "management-meeting:management-1": "02f277e3-632f-541d-89ae-3fbdee4ccc7c",
    "management-meeting:management-2": "d7175408-88db-5706-807c-b782e60cffca",
    "partnerships-standup": "7d83a2a5-65c2-5799-acd0-d3674a35341c",
    "mtn-venue-walkthrough": "a1c51c6c-e915-5b55-9d36-fff2f4c1d453",
    "team-check-in": "28dae704-3eb8-52a1-bd9e-ba6ba5b8d4d4",
    "listings-review": "9b261a66-e7a6-59e9-ba9d-ea47c4b87da1",
  },
  task: {
    "review-shortlist": "343bb7b1-cd28-531e-8f9e-a013c671dadc",
    "payroll-preview": "45d3950c-7d19-51e0-bfa7-1b87ebabc44c",
    "close-out-targets": "c275df4c-8507-519a-94d7-b6539f739830",
    "q4-social-calendar": "0f697d9e-45f8-5144-baf3-6af7a95660b6",
    "partner-pitch-deck": "9b6d20d1-69a9-5dd5-9717-b0c9c19c2720",
    "partner-contact-log": "749f4e2c-1f21-5bb6-b3e5-e0de2063b018",
    "chase-eko-proposal": "51b03091-4ce4-587a-aad5-c361af90f62f",
    "enugu-listings": "8f95d096-0868-590d-a44c-e5f3bbd8bb0c",
    "android-clock-in": "b0128ef7-b218-589f-852e-633b395e3b12",
  },
  employee_target: {
    "enugu-content": "8bd2bb7c-3ea9-5f92-a06a-0ce47e584277",
    "pitch-deck": "f1798b90-c9d0-5311-a2b3-bc1f4eb04307",
    "social-growth": "8fd03930-6b82-5469-a772-da9931690174",
    "enugu-places": "19cbcb51-ff2e-5f75-a485-6f6f831dfd9f",
    "new-prospects": "00250962-ea1d-5f41-bca1-58641682063f",
    "approval-turnaround": "2c0bbbe9-d481-5a99-af8a-ed10fa1f53b3",
  },
  organisational_goal: {
    "active-residents": "4a460aa7-5053-5dae-93b1-5f67bb1e1d3f",
    "partnership-revenue": "9d654e4f-2426-5172-affa-2cce9539e213",
    "twelve-cities": "270e8fa7-f8bf-53a6-9496-e7a1483aad6c",
    "operations-platform": "6937eaab-ab47-5c9e-95e4-b9d19ac8c336",
    "forty-person-team": "861d50a2-618e-5942-8e8c-38ab2baa4964",
  },
  performance_review: {
    "self:head_team:1": "08abebfc-60fa-55b6-a718-c4e8029e081b",
    "manager:head_team:1": "f464d2bb-09a1-5602-b9f7-179407462db2",
    "self:head_team:2": "b28f2e14-b915-550f-b7ab-f11e0b35d2f6",
    "manager:head_team:2": "6c627380-9c9b-5356-99cf-14f6a4a57d0d",
    "self:head_team:3": "f42ca22d-5c4e-510e-8c05-20d1558b434a",
    "manager:head_team:3": "4289d002-1dac-59c7-a3ed-4e1ade306ed1",
    "self:manager_team:1": "fdfe311e-fb2b-5b31-9c11-9dee04fff041",
    "manager:manager_team:1": "2b1a34b2-b5cb-5d90-a096-ff31398b3b4b",
    "self:manager_team:2": "bde47673-b55c-5691-acf9-620e6084f958",
    "manager:manager_team:2": "1394144a-f363-5e8d-b74d-1a1af572d4d8",
  },
  performance_cycle: {
    "quarter-check-in": "59a3d686-4710-5e8e-908e-11305099719f",
  },
  vacancy: {
    "open-seat-1": "ef49c38b-f3e8-5e99-94c5-d6be54f15306",
    "open-seat-2": "5b412bed-d2a3-5edc-8375-e9d4fd4c693a",
  },
});

/** @type {ReadonlyArray<{table: string, id_column: string, ids: ReadonlyArray<string>}>} */
const HOME_STAGING_ROWS = Object.freeze(
  DELETE_ORDER.map((table) =>
    Object.freeze({ table, id_column: `${table}_id`, ids: Object.freeze(Object.values(IDS[table])) }),
  ),
);

/**
 * Delete these ids and the alerts about them: the alerts first, then the rows, children before
 * parents. An id with no row is passed over. An alert is found by its subject_id alone: each id
 * is a name in the Home seed's own namespace, so no other record has it, whatever subject type a
 * metric gives the row.
 * @param {{query: Function}} db  a client inside the caller's transaction
 * @param {Array<{table: string, ids: ReadonlyArray<string>}>} entries  tables of DELETE_ORDER
 * @returns {Promise<{rows: number, alerts: number}>}
 */
async function removeRows(db, entries) {
  const unknown = entries.find((e) => !DELETE_ORDER.includes(e.table));
  if (unknown) throw new Error(`home-staging-rows: "${unknown.table}" holds none of Home's staging rows`);
  const ids = entries.flatMap((e) => e.ids);
  if (!ids.length) return { rows: 0, alerts: 0 };
  const alerts = await db.query("DELETE FROM home_alert WHERE subject_id = ANY($1::text[])", [ids]);
  let rows = 0;
  for (const table of DELETE_ORDER) {
    const these = entries.filter((e) => e.table === table).flatMap((e) => e.ids);
    if (these.length) rows += (await db.query(`DELETE FROM ${table} WHERE ${table}_id = ANY($1::uuid[])`, [these])).rowCount;
  }
  return { rows, alerts: alerts.rowCount };
}

/**
 * Step 1 above: delete Home's rows from these tables, and the alerts Home raised about them.
 * @param {{query: Function}} db  a client inside the caller's transaction
 * @param {string[]} tables
 */
const removeHomeStagingRows = (db, tables) =>
  removeRows(
    db,
    tables.map((table) => ({ table, ids: HOME_STAGING_ROWS.find((e) => e.table === table)?.ids || [] })),
  );

module.exports = { DELETE_ORDER, HOME_STAGING_ROWS, IDS, removeRows, removeHomeStagingRows };
