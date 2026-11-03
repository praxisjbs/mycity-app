"use strict";
/**
 * Praxis AI's People cards on the real migrations (docs/guides/praxis-ai.md §6.11, decision 33):
 * every form of People in the chat, each through the screen's own function and refused where the
 * screen refuses. Approve Overtime for a report after Confirm It's You, never the outsider or one's
 * own; Add Work Site with its place picked as every address is (one place our search finds is
 * signed, several or none are Pick one, never a guess; never a Temporary Home); Add Type and Save
 * Type, the code made from the name; Record Leave approved at once after Confirm It's You; Add
 * Employee with its work record alone, asked for what it needs first; Save Record and Save Line;
 * Add Department and Save Department with the grant over everyone; Add Role and Save Role; Add
 * Worksite and Save Worksite, the centre the place's point.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/ai-actions-people
 */
process.env.GEMINI_API_KEY = "test-key";
const c = require("@mycity/contract");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");

jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async () => ({ id: "1" })),
  getQueue: jest.fn(() => ({ getDelayed: async () => [] })),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const workingWeek = require("../../src/shared/time/working-week");
const lagos = require("../../src/shared/time/lagos");
const registry = require("../../src/shared/ai/registry");
const token = require("../../src/shared/places/token");
const geoapify = require("../../src/services/maps/geoapify.service");
const orgCards = require("../../src/modules/organisation/organisation.cards");
const { q, one, drain, fresh, script, say, harness } = require("./helpers/ai-actions");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

/** A place as our search signs it. */
const place = (formatted, lat, lon) =>
  token.sign({ source: "search", formatted, lat, lon, provider_id: `test:${formatted}`, kind: "building", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos", verified: true, pending: false });
/** A place as the provider answers a search with it. */
const hit = (formatted, lat, lon) => ({ place_id: `test:${formatted}`, formatted, lat, lon, kind: "building", city: "Lagos", state: "Lagos", country_code: "ng", timezone: "Africa/Lagos" });
const dayFirst = (iso) => iso.split("-").reverse().join("/");

describeDb("Praxis AI's People cards against the real migrations", () => {
  let app;
  let h;
  let calendar = null;

  /** Monday to Friday of a week ahead, each a working day, `n` weeks on (as the leave suite picks them). */
  function week(n) {
    const d = new Date(Date.now() + 2 * 7 * 86_400_000);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    let clean = 0;
    for (;;) {
      const days = Array.from({ length: 5 }, (_, i) => new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10));
      if (days.every((day) => workingWeek.isWorkingDay(day, calendar))) {
        clean += 1;
        if (clean === n - 1) return days;
      }
      d.setUTCDate(d.getUTCDate() + 7);
    }
  }

  /** The card the model drafts for a question, as the answer carries it. */
  const drawn = async (who, key, values, question = "Do it.") => {
    script(say({ text: "Here it is.", action: { key, values, suggested: false } }));
    const asked = await h.ask(who, { question, shows: ["cards"] });
    expect(asked.status).toBe(200);
    expect(c.assistant.AiAnswer.safeParse(asked.body).success).toBe(true);
    return asked.body.card;
  };
  const id = (who) => h.people[who].employee_id;

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    workingWeek.invalidateCalendar();
    calendar = await workingWeek.loadCalendar(pool);
    outbox.markReady();
    ({ app } = buildApp({ strict: true, accessLog: false }));
    h = harness(app);
    await h.makePeople([
      { who: "ceo", first: "Amaka", last: "Eze", email: "ceo@mycity.test", job: "Chief Executive Officer", role: "management", ceo: true, password: "Chief#Officer26" },
      { who: "ops", first: "Ada", last: "Obi", email: "ops@mycity.test", job: "Operations & People Lead", role: "operations_people", password: "Opera!ions2026", department: "Operations" },
      { who: "manager", first: "Kemi", last: "Alade", email: "manager@mycity.test", job: "Programme Lead", role: "manager", password: "Programme#Lead2026", department: "Programmes" },
      { who: "staff", first: "Tunde", last: "Ade", email: "tunde@mycity.test", job: "Field Officer", role: "employee", password: "Staff#Member2026", department: "Programmes" },
      { who: "outsider", first: "Bisi", last: "Ade", email: "outsider@mycity.test", job: "Accounts Officer", role: "employee", password: "Staff#Member2026", department: "Finance" },
    ]);
    await q("UPDATE employee SET line_manager_id = $1 WHERE employee_id = $2", [id("manager"), id("staff")]);
    await grantsCache.bumpTeamVersion();
    await drain();
    registry.load();
    fresh();
  }, 120_000);

  afterAll(async () => {
    registry.reset();
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fresh();
  });

  test("overtime.approve: Approve Overtime names the person, waits on Confirm It's You, and approves through the sheet's own function; the outsider and one's own refused", async () => {
    const day = lagos.addDays(lagos.today(), 3);
    // Whose overtime, when not said, is asked first with the people in the manager's reach to tap (decision 34).
    script(say({ text: "Here it is.", action: { key: "overtime.approve", values: { work_date: day, minutes: 90, reason: "The quarterly stock count after hours" }, suggested: false } }));
    const who = await h.ask("manager", { question: "Approve 90 minutes of overtime for the stock count.", shows: ["cards"] });
    expect(who.body).toMatchObject({ content: "Whose overtime is it?", card: null });
    expect(who.body.choices).toEqual(expect.arrayContaining([expect.stringContaining("Tunde Ade")]));
    expect(who.body.choices.join(" ")).not.toContain("Bisi Ade");
    const card = await drawn("manager", "overtime.approve", { employee_id: id("staff"), work_date: day, minutes: 90, reason: "The quarterly stock count after hours" }, "Approve 90 minutes of overtime for Tunde.");
    expect(card).toMatchObject({ action_key: "overtime.approve", label: "Approve Overtime", schema: "attendance.OvertimePreApprovalCreate", risk: "approval", confirm: "fresh_sign_in", problems: {} });
    expect(card.records).toEqual([expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade" })]);
    expect(card.fields.find((f) => f.name === "employee_id")).toMatchObject({ kind: "id", picks: "employee", label: "Person" });

    await h.stale("manager");
    const stale = await h.press("manager", card.ai_action_draft_id);
    expect([stale.status, stale.body.error.code]).toEqual([403, "REAUTH_REQUIRED"]);
    await h.confirmPassword("manager");
    const pressed = await h.press("manager", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "employee", id: id("staff"), label: `Tunde Ade, ${dayFirst(day)}`, ok: true, message: "approved" })]);
    expect(await one("SELECT minutes FROM attendance_overtime_approval WHERE employee_id = $1 AND work_date = $2", [id("staff"), day])).toEqual({ minutes: 90 });

    // The outsider is off the manager's team: never named, marked Pick one, and the press refused with nothing approved.
    const theirs = await drawn("manager", "overtime.approve", { employee_id: id("outsider"), work_date: day, minutes: 60, reason: "An evening shift for the count" });
    expect(theirs.records).toEqual([]);
    expect(theirs.problems).toEqual({ employee_id: ["Pick one"] });
    expect((await h.press("manager", theirs.ai_action_draft_id)).status).toBe(422);
    expect(await one("SELECT count(*)::int AS n FROM attendance_overtime_approval WHERE employee_id = $1", [id("outsider")])).toEqual({ n: 0 });

    // One's own overtime is approved by someone else: refused at the press by the sheet's own rule.
    const own = await drawn("ops", "overtime.approve", { employee_id: id("ops"), work_date: day, minutes: 60, reason: "My own evening at the count" });
    await h.confirmPassword("ops");
    const ownPress = await h.press("ops", own.ai_action_draft_id);
    expect([ownPress.status, ownPress.body.error.code]).toEqual([403, "OWN_RECORD"]);
    // Staff without the grant are never drawn the card.
    expect(await drawn("staff", "overtime.approve", { employee_id: id("outsider"), work_date: day, minutes: 60, reason: "An evening shift for the count" })).toBeNull();
  });

  test("temporary_sites.add: Add Work Site's place is the one our search finds, signed and named by its line; several or none are Pick one, never a guess; never a Temporary Home", async () => {
    const [mon, , wed] = week(2);
    const eko = "Eko Hotel, Adetokunbo Ademola Street, Victoria Island, Lagos";
    const values = { purpose: "training_attending", name: "Partner Training", description: "Attending the partner training at the Eko Hotel for three days.", starts_on: mon, ends_on: wed, address: "Eko Hotel Victoria Island", employee_ids: [id("staff")] };
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([hit(eko, 6.4269, 3.4296)]);
    const card = await drawn("staff", "temporary_sites.add", values, "Add a work site for me at the Eko Hotel for the partner training.");
    expect(card).toMatchObject({ action_key: "temporary_sites.add", label: "Add Work Site", schema: "attendance.TemporarySiteAdd", risk: "standard", records: [], problems: {} });
    expect(c.maps.readPlaceToken(card.values.address)).toMatchObject({ formatted: eko, lat: 6.4269, lon: 3.4296 });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "place", label: eko }), expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade" })]));
    expect(card.fields.find((f) => f.name === "address")).toMatchObject({ kind: "id", picks: "place", label: "Address" });
    expect(card.fields.find((f) => f.name === "employee_ids")).toMatchObject({ picks: "site_member" });
    expect(card.fields.find((f) => f.name === "purpose").options).not.toContain("temporary_home");

    const pressed = await h.press("staff", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "attendance_temporary_site", label: expect.stringMatching(/ Partner Training$/), ok: true, message: "sent for approval", link: expect.stringMatching(/^\/ess\?tab=work-location-requests&site=/) })]);
    const site = await one("SELECT temporary_site_id, status FROM attendance_temporary_site WHERE name = 'Partner Training'");
    expect(site.status).toBe("submitted");
    expect(await one("SELECT address, radius_m FROM attendance_temporary_site_location WHERE temporary_site_id = $1", [site.temporary_site_id])).toEqual({ address: eko, radius_m: 150 });

    // Two places answer the words: nothing is guessed, the card says Pick one and the press sends nothing.
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([hit("Ikoyi Club, Ikoyi, Lagos", 6.452, 3.433), hit("Ikoyi Hotel, Ikoyi, Lagos", 6.449, 3.435)]);
    const several = await drawn("staff", "temporary_sites.add", { ...values, name: "Ikoyi Visit", address: "Ikoyi" });
    expect(several.problems).toEqual({ address: ["Pick one"] });
    expect(several.values.address).toBe("Ikoyi");
    expect((await h.press("staff", several.ai_action_draft_id)).status).toBe(422);
    // Address search down: the person picks it, as the field asks again on the screen.
    jest.spyOn(geoapify, "searchPlaces").mockRejectedValue(Object.assign(new Error("down"), { code: "MAPS_UNAVAILABLE" }));
    const down = await drawn("staff", "temporary_sites.add", { ...values, name: "Ikoyi Visit", address: "Ikoyi Club" });
    expect(down.problems).toEqual({ address: ["Pick one"] });
    // Edit picks the place with AddressField: Save Changes names it by its line and clears the mark.
    const ikoyi = place("Ikoyi Club, Ikoyi, Lagos", 6.452, 3.433);
    const edited = await h.as("staff").put(`/ai/cards/${several.ai_action_draft_id}`).send({ values: { ...several.values, address: ikoyi } });
    expect(edited.status).toBe(200);
    expect(edited.body.problems).toEqual({});
    expect(edited.body.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "place", id: ikoyi, label: "Ikoyi Club, Ikoyi, Lagos" })]));
    // A token no search of ours signed names nothing.
    const forged = `${ikoyi.split(".").slice(0, 2).join(".")}.AAAAAAAAAAAAAAAAAAAAAA`;
    const fake = await h.as("staff").put(`/ai/cards/${several.ai_action_draft_id}`).send({ values: { ...several.values, address: forged } });
    expect(fake.body.problems).toEqual({ address: ["Pick one"] });
    // A Temporary Home is a home, personal data: never a card's purpose.
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([hit(eko, 6.4269, 3.4296)]);
    const home = await drawn("staff", "temporary_sites.add", { ...values, name: "My Aunt's House", purpose: "temporary_home" });
    expect(Object.keys(home.problems)).toEqual(["purpose"]);
  });

  test("leave_types.add and leave_types.edit: Add Type makes the code from the name as the sheet does; Save Type, by its words, waits on Confirm It's You", async () => {
    const add = await drawn("ops", "leave_types.add", { name: "Study Leave", days_per_year: 5 }, "Add a leave type called Study Leave with 5 days a year.");
    expect(add).toMatchObject({ action_key: "leave_types.add", label: "Add Type", schema: "leave.LeaveTypeAdd", risk: "standard", records: [], problems: {} });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "leave_type", label: "Study Leave", ok: true, message: "added" })]);
    const type = await one("SELECT leave_type_id, code, (policy ->> 'days_per_year')::int AS days FROM leave_type WHERE name = 'Study Leave'");
    expect(type).toMatchObject({ code: "study_leave", days: 5 });

    const edit = await drawn("ops", "leave_types.edit", { leave_type_id: "study", days_per_year: 7 }, "Give Study Leave 7 days a year.");
    expect(edit).toMatchObject({ action_key: "leave_types.edit", label: "Save Type", schema: "leave.LeaveTypeChange", risk: "approval", confirm: "fresh_sign_in", values: { leave_type_id: type.leave_type_id, days_per_year: 7 }, problems: {} });
    expect(edit.records).toEqual([expect.objectContaining({ type: "leave_type", id: type.leave_type_id, label: "Study Leave" })]);
    await h.confirmPassword("ops");
    const saved = await h.press("ops", edit.ai_action_draft_id);
    expect(saved.status).toBe(200);
    expect(saved.body.lines).toEqual([expect.objectContaining({ label: "Study Leave", ok: true, message: "saved" })]);
    expect(await one("SELECT (policy ->> 'days_per_year')::int AS days FROM leave_type WHERE leave_type_id = $1", [type.leave_type_id])).toEqual({ days: 7 });

    // Nothing to change: the problem on the type's own field. Staff without the grant draw no card.
    expect((await drawn("ops", "leave_types.edit", { leave_type_id: type.leave_type_id })).problems).toEqual({ leave_type_id: ["Nothing to change"] });
    expect(await drawn("staff", "leave_types.add", { name: "Party Leave", days_per_year: 30 })).toBeNull();
  });

  test("leave.record: Record Leave matches the type by name, names the person, and records it approved at once through the screen's own function after Confirm It's You", async () => {
    const [mon, tue] = week(3);
    const annual = (await one("SELECT leave_type_id FROM leave_type WHERE code = 'annual'")).leave_type_id;
    const card = await drawn("ops", "leave.record", { employee_id: id("staff"), leave_type_id: "Annual Leave", starts_on: mon, ends_on: tue, reason: "Agreed on paper last week" }, "Record two days of annual leave for Tunde.");
    expect(card).toMatchObject({ action_key: "leave.record", label: "Record Leave", schema: "leave.LeaveRecordCreate", risk: "approval", values: { leave_type_id: annual }, problems: {} });
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade" }), expect.objectContaining({ type: "leave_type", id: annual, label: "Annual" })]));
    await h.confirmPassword("ops");
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "leave_request", label: "Tunde Ade, Annual, 2 days", ok: true, message: "recorded" })]);
    expect(await one("SELECT status, recorded_by FROM leave_request WHERE leave_request_id = $1", [pressed.body.lines[0].id])).toEqual({ status: "approved", recorded_by: h.people.ops.user_id });

    // An id that is nobody's names nothing: Pick one, and the press sends nothing.
    const nobody = await drawn("ops", "leave.record", { employee_id: "0d663c19-94bc-4ce9-93ef-95db8c56fa76", leave_type_id: annual, starts_on: mon, ends_on: tue });
    expect(nobody.problems).toEqual({ employee_id: ["Pick one"] });
    // A line manager may approve, never record: no card.
    expect(await drawn("manager", "leave.record", { employee_id: id("staff"), leave_type_id: annual, starts_on: mon, ends_on: tue })).toBeNull();
  });

  test("employees.add: asked for what the record needs first, drawn with the work record alone (never personal, bank or pay), and added through Add Employee's own function", async () => {
    script(say({ text: "Here is the record.", action: { key: "employees.add", values: { first_name: "Bola", last_name: "Ojo" }, suggested: false } }));
    const asked = await h.ask("ops", { question: "Add Bola Ojo.", shows: ["cards"] });
    expect(asked.body).toMatchObject({ content: "What is their job title?", card: null });

    const finance = (await one("SELECT department_id FROM department WHERE name = 'Finance'")).department_id;
    const values = { first_name: "Bola", last_name: "Ojo", work_email: "bola.ojo@mycity.test", phone: "08035550101", job_title: "Accounts Officer", department_id: "Finance", line_manager_id: id("ops"), start_date: "2026-12-01", employment_type: "full_time", work_pattern: "remote" };
    const card = await drawn("ops", "employees.add", { ...values, date_of_birth: "1990-04-02", gross_monthly: "450000.00", bank_name: "Zenith Bank", next_of_kin_name: "Femi Ojo" }, "Add Bola Ojo as an Accounts Officer in Finance.");
    expect(card).toMatchObject({ action_key: "employees.add", label: "Add Employee", schema: "organisation.EmployeeAdd", risk: "standard", problems: {} });
    // The phone as the contract keeps every phone, with its country code.
    expect(card.values).toEqual({ ...values, department_id: finance, phone: "+2348035550101" });
    expect(card.fields.map((f) => f.name)).toEqual(["first_name", "middle_name", "last_name", "preferred_name", "work_email", "phone", "job_title", "department_id", "line_manager_id", "worksite_id", "start_date", "employment_type", "work_pattern", "contract_ends_on", "confirmation_due_on"]);
    expect(card.names).toEqual(expect.arrayContaining([expect.objectContaining({ type: "department", id: finance, label: "Finance" }), expect.objectContaining({ type: "employee", id: id("ops"), label: "Ada Obi" })]));
    const pressed = await h.press("ops", card.ai_action_draft_id);
    expect(pressed.status).toBe(200);
    expect(pressed.body.lines).toEqual([expect.objectContaining({ type: "employee", label: "Bola Ojo", ok: true, message: "added", link: expect.stringMatching(/^\/people\?tab=employees&id=/) })]);
    const bola = await one("SELECT staff_number, department_id, line_manager_id, date_of_birth, gross_monthly, bank_name, next_of_kin_name FROM employee WHERE work_email = 'bola.ojo@mycity.test'");
    expect(bola).toMatchObject({ department_id: finance, line_manager_id: id("ops"), date_of_birth: null, gross_monthly: null, bank_name: null, next_of_kin_name: null });
    expect(bola.staff_number).toBeTruthy();

    // On Site with no worksite: Add Employee's own rule, on the field.
    const onSite = await drawn("ops", "employees.add", { ...values, work_email: "kola.ojo@mycity.test", first_name: "Kola", work_pattern: "on_site" });
    expect(onSite.problems).toEqual({ worksite_id: ["Pick a worksite"] });
  });

  test("employees.edit and employees.reporting: Save Record changes the work record alone and Save Line who someone reports to, each naming the record; nothing to change says so", async () => {
    const card = await drawn("ops", "employees.edit", { employee_id: id("staff"), job_title: "Senior Field Officer", date_of_birth: "1991-05-05" }, "Make Tunde a Senior Field Officer.");
    expect(card).toMatchObject({ action_key: "employees.edit", label: "Save Record", schema: "organisation.EmployeeChange", problems: {}, values: { employee_id: id("staff"), job_title: "Senior Field Officer" } });
    expect(card.values.date_of_birth).toBeUndefined();
    expect(card.records).toEqual([expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade" })]);
    const saved = await h.press("ops", card.ai_action_draft_id);
    expect(saved.status).toBe(200);
    expect(saved.body.lines).toEqual([expect.objectContaining({ type: "employee", id: id("staff"), label: "Tunde Ade", ok: true, message: "saved" })]);
    expect(await one("SELECT job_title, date_of_birth FROM employee WHERE employee_id = $1", [id("staff")])).toEqual({ job_title: "Senior Field Officer", date_of_birth: null });
    expect((await drawn("ops", "employees.edit", { employee_id: id("staff") })).problems).toEqual({ employee_id: ["Nothing to change"] });

    const line = await drawn("ops", "employees.reporting", { employee_id: id("staff"), dotted_manager_id: id("ops"), reason: "Matrix work on the launch" }, "Tunde also reports to Ada for the launch.");
    expect(line).toMatchObject({ action_key: "employees.reporting", label: "Save Line", schema: "organisation.EmployeeReportingChange", problems: {} });
    expect(line.names).toEqual([expect.objectContaining({ type: "employee", id: id("ops"), label: "Ada Obi" })]);
    const lined = await h.press("ops", line.ai_action_draft_id);
    expect(lined.status).toBe(200);
    expect(await one("SELECT line_manager_id, dotted_manager_id FROM employee WHERE employee_id = $1", [id("staff")])).toEqual({ line_manager_id: id("manager"), dotted_manager_id: id("ops") });
    expect((await drawn("ops", "employees.reporting", { employee_id: id("staff"), line_manager_id: id("staff") })).problems).toEqual({ line_manager_id: ["Not themselves"] });
    // A line manager's grant changes no record: no card.
    expect(await drawn("manager", "employees.edit", { employee_id: id("staff"), job_title: "Lead" })).toBeNull();
  });

  test("departments and roles: Add Department and Save Department with the grant over everyone, Add Role and Save Role by its title, each through the screen's own function", async () => {
    const add = await drawn("ops", "departments.create", { name: "Partnerships", code: "PRT", head_employee_id: id("ceo") }, "Add a department called Partnerships.");
    expect(add).toMatchObject({ action_key: "departments.create", label: "Add Department", schema: "organisation.DepartmentCreate", problems: {} });
    expect(add.names).toEqual([expect.objectContaining({ type: "employee", id: id("ceo"), label: "Amaka Eze" })]);
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "department", label: "Partnerships", ok: true, message: "added", link: expect.stringMatching(/^\/people\?tab=departments&id=/) })]);
    const dept = await one("SELECT department_id, code::text AS code, head_employee_id FROM department WHERE name = 'Partnerships'");
    expect(dept).toMatchObject({ code: "PRT", head_employee_id: id("ceo") });

    const edit = await drawn("ops", "departments.edit", { department_id: "Partnerships", description: "Partners and growth" });
    expect(edit).toMatchObject({ label: "Save Department", schema: "organisation.DepartmentChange", values: { department_id: dept.department_id }, problems: {} });
    expect(edit.records).toEqual([expect.objectContaining({ type: "department", id: dept.department_id, label: "Partnerships" })]);
    expect((await h.press("ops", edit.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT description FROM department WHERE department_id = $1", [dept.department_id])).toEqual({ description: "Partners and growth" });
    // Departments are the company's: a team scope is refused by the department's own rule.
    await expect(orgCards.assertCardDepartment(pool, dept.department_id, { scope: "team", scope_ids: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const role = await drawn("ops", "seats.create", { title: "Head of Partnerships", department_id: "Partnerships", line_manager_id: id("ceo") });
    expect(role).toMatchObject({ label: "Add Role", schema: "organisation.OrgSeatCreate", problems: {} });
    expect((await h.press("ops", role.ai_action_draft_id)).status).toBe(200);
    const seat = await one("SELECT org_seat_id, status, line_manager_id FROM org_seat WHERE title = 'Head of Partnerships'");
    expect(seat).toMatchObject({ status: "vacant", line_manager_id: id("ceo") });
    const close = await drawn("ops", "seats.edit", { org_seat_id: "Head of Partnerships", status: "closed" });
    expect(close).toMatchObject({ label: "Save Role", schema: "organisation.OrgSeatChange", values: { org_seat_id: seat.org_seat_id }, problems: {} });
    expect(close.records).toEqual([expect.objectContaining({ type: "org_seat", id: seat.org_seat_id, label: "Head of Partnerships, Partnerships" })]);
    expect((await h.press("ops", close.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT status FROM org_seat WHERE org_seat_id = $1", [seat.org_seat_id])).toEqual({ status: "closed" });
  });

  test("worksites.create and worksites.edit: the place picked as every address is, the centre its point; words matching several places are Pick one", async () => {
    const lekki = place("Admiralty Way, Lekki Phase 1, Lagos", 6.4474, 3.4723);
    const add = await drawn("ops", "worksites.create", { name: "Lekki Office", address: lekki, radius_m: 150 }, "Add the Lekki Office as a worksite.");
    expect(add).toMatchObject({ action_key: "worksites.create", label: "Add Worksite", schema: "worksites.WorksiteAdd", problems: {}, names: [expect.objectContaining({ type: "place", id: lekki, label: "Admiralty Way, Lekki Phase 1, Lagos" })] });
    expect(add.fields.find((f) => f.name === "address")).toMatchObject({ kind: "id", picks: "place" });
    const added = await h.press("ops", add.ai_action_draft_id);
    expect(added.status).toBe(200);
    expect(added.body.lines).toEqual([expect.objectContaining({ type: "worksite", label: "Lekki Office", ok: true, message: "added" })]);
    const site = await one("SELECT worksite_id, code::text AS code, latitude::float8 AS lat, longitude::float8 AS lon, radius_m FROM worksite WHERE name = 'Lekki Office'");
    expect(site).toMatchObject({ code: "LEKKI-OFFICE", lat: 6.4474, lon: 3.4723, radius_m: 150 });

    // The words name one place: it is signed and the centre moves to its point.
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([hit("Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos", 6.6142, 3.3581)]);
    const move = await drawn("ops", "worksites.edit", { worksite_id: "Lekki Office", address: "Ikeja City Mall", radius_m: 200 });
    expect(move).toMatchObject({ label: "Save Worksite", schema: "worksites.WorksiteChange", values: { worksite_id: site.worksite_id, radius_m: 200 }, problems: {} });
    expect(move.records).toEqual([expect.objectContaining({ type: "worksite", id: site.worksite_id, label: "Lekki Office" })]);
    expect((await h.press("ops", move.ai_action_draft_id)).status).toBe(200);
    expect(await one("SELECT latitude::float8 AS lat, longitude::float8 AS lon, radius_m FROM worksite WHERE worksite_id = $1", [site.worksite_id])).toEqual({ lat: 6.6142, lon: 3.3581, radius_m: 200 });

    // Two places answer the words: Pick one, and the press moves nothing.
    jest.spyOn(geoapify, "searchPlaces").mockResolvedValue([hit("Allen Avenue, Ikeja, Lagos", 6.6018, 3.3515), hit("Allen Roundabout, Ikeja, Lagos", 6.5995, 3.3532)]);
    const two = await drawn("ops", "worksites.edit", { worksite_id: site.worksite_id, address: "Allen" });
    expect(two.problems).toEqual({ address: ["Pick one"] });
    expect((await h.press("ops", two.ai_action_draft_id)).status).toBe(422);
    expect(await one("SELECT latitude::float8 AS lat FROM worksite WHERE worksite_id = $1", [site.worksite_id])).toEqual({ lat: 6.6142 });
  });
});
