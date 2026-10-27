"use strict";
/**
 * MyCity's names for its functions, posts and seats (docs/guides/performance.md §6.20): the staff
 * loader with `seeds/staff/nomenclature.json`, against the real migrations.
 *
 * Staging and production already hold the roster as the sheet of 16/10/2026 spelled it. This
 * loads that roster first (the real sheet with the old names put back), then the real sheet of
 * 22/10/2026: departments are renamed in place (same ids, nobody moved out), Partnership & Growth
 * takes its posts, posts and seats take the chart's titles, David reports to Chinyere, each
 * department has its code and head, and a second deploy changes nothing. A fresh database
 * loaded from the new sheet ends the same way.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/staff-nomenclature
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { rebuild } = require("./helpers/schema");
const outbox = require("../../src/shared/events/outbox");
const loader = require("../../scripts/db/load-staff");
const names = require("../../scripts/db/staff-nomenclature");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const rows = async (sql, params) => (await q(sql, params)).rows;

/** The real sheet with the names of 16/10/2026 put back, and without the seats added since. */
async function oldSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(loader.SHEET);
  const ws = wb.worksheets[0];
  const header = ws.getRow(1).values.map((v) => String(v ?? "").trim());
  const col = (name) => header.indexOf(name);
  const back = {
    "Backend Operations Manager": "Back-end Manager",
    "Graphics Associate": "Graphics Design Associate",
    "Head, PR, Marketing & Brand Strategy": "Head PR, Marketing & Brand Strategy",
    "Head, Strategy, Partnerships & Growth": "Head Sales & Revenue",
  };
  const added = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const des = String(row.getCell(col("Designation")).value ?? "");
    const team = String(row.getCell(col("Team")).value ?? "");
    const name = String(row.getCell(col("Name")).value ?? "");
    const lm = String(row.getCell(col("Line Manager")).value ?? "");
    if (name === "VACANT" && (des === "HR/Admin Associate" || /^Growth Officer - (Rivers|Anambra|Ekiti|Edo|Delta|Cross River)$/.test(des))) {
      added.push(n);
      return;
    }
    let old = back[des] || des;
    if (/^Growth Officer - /.test(des)) old = des.replace("Growth Officer - ", "Marketing & Growth Officer - ");
    row.getCell(col("Designation")).value = old;
    const oldTeam = {
      "Branding & Marketing": "Sales & Marketing",
      "Partnership & Growth": "Sales & Marketing",
      "People & Culture": "HR & Operations",
      "Technology & Back-office Ops": des === "Chief Technology Officer" ? "Technology" : "Backend Operations",
    }[team];
    if (oldTeam) row.getCell(col("Team")).value = oldTeam;
    if (lm.startsWith("Head, Strategy, Partnerships & Growth"))
      row.getCell(col("Line Manager")).value = lm.replace("Head, Strategy, Partnerships & Growth", "Head Sales & Revenue");
    if (des === "PR & Marketing Lead - MyLagosApp")
      row.getCell(col("Line Manager")).value = "Head Sales & Revenue, with dotted line to Head PR & Marketing";
  });
  for (const n of added.reverse()) ws.spliceRows(n, 1);
  await wb.xlsx.writeFile(file);
}

describeDb("staff nomenclature against the real migrations", () => {
  let temp;
  const quiet = () => {};

  beforeAll(async () => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-names-"));
    outbox.markReady();
  });

  afterAll(async () => {
    fs.rmSync(temp, { recursive: true, force: true });
    await pool.end();
  });

  const department = async (name) =>
    (await rows("SELECT department_id, code::text AS code, active, head_employee_id, head_seat_id FROM department WHERE name = $1", [name]))[0];
  const personByTitle = async (title) =>
    (await rows("SELECT employee_id, department_id, line_manager_id, line_manager_seat_id, dotted_manager_id FROM employee WHERE job_title = $1", [title]))[0];

  async function expectChartNames() {
    const active = await rows("SELECT name, code::text AS code FROM department WHERE active AND code <> 'TEST' ORDER BY code");
    expect(active).toEqual([
      { name: "Branding & Marketing", code: "BM" },
      { name: "General Management", code: "GM" },
      { name: "People & Culture", code: "PC" },
      { name: "Partnership & Growth", code: "PG" },
      { name: "Technology & Back-office Ops", code: "TBO" },
    ]);
    const pg = await department("Partnership & Growth");
    const bm = await department("Branding & Marketing");
    const pgPeople = await rows(
      "SELECT job_title FROM employee WHERE department_id = $1 AND status <> 'archived' ORDER BY job_title",
      [pg.department_id],
    );
    expect(pgPeople.map((r) => r.job_title)).toEqual([
      "Growth Officer - Abia",
      "Growth Officer - Enugu",
      "Growth Officer - Imo",
      "Growth Officer - Kano",
      "Marketing Lead - Abuja",
      "Marketing Lead - South West",
    ]);
    expect((await personByTitle("Backend Operations Manager")).department_id).toBe((await department("Technology & Back-office Ops")).department_id);
    expect((await personByTitle("Chief Technology Officer")).department_id).toBe((await department("Technology & Back-office Ops")).department_id);
    expect(await personByTitle("Graphics Associate")).toBeDefined();

    const head = await rows("SELECT org_seat_id, department_id, status FROM org_seat WHERE title = 'Head, Strategy, Partnerships & Growth'");
    expect(head).toHaveLength(1);
    expect(head[0]).toMatchObject({ department_id: pg.department_id, status: "vacant" });
    const seats = await rows("SELECT title FROM org_seat WHERE department_id = $1 AND status = 'vacant' ORDER BY title", [pg.department_id]);
    expect(seats.map((s) => s.title)).toEqual([
      "Growth Officer - Anambra",
      "Growth Officer - Cross River",
      "Growth Officer - Delta",
      "Growth Officer - Edo",
      "Growth Officer - Ekiti",
      "Growth Officer - Rivers",
      "Head, Strategy, Partnerships & Growth",
    ]);
    expect(await rows("SELECT 1 FROM org_seat WHERE title = 'HR/Admin Associate' AND status = 'vacant'")).toHaveLength(1);
    expect(await rows("SELECT 1 FROM org_seat WHERE title = 'Head Sales & Revenue'")).toHaveLength(0);

    const chinyere = await personByTitle("Head, PR, Marketing & Brand Strategy");
    const david = await personByTitle("PR & Marketing Lead - MyLagosApp");
    expect(david).toMatchObject({ department_id: bm.department_id, line_manager_id: chinyere.employee_id, line_manager_seat_id: null });
    expect(david.dotted_manager_id).not.toBe(chinyere.employee_id);
    const john = await personByTitle("Marketing Lead - South West");
    expect(john).toMatchObject({ line_manager_seat_id: head[0].org_seat_id, dotted_manager_id: chinyere.employee_id });

    expect((await department("General Management")).head_employee_id).toBe((await personByTitle("Chief Executive Officer")).employee_id);
    expect((await department("Technology & Back-office Ops")).head_employee_id).toBe((await personByTitle("Chief Technology Officer")).employee_id);
    expect(bm.head_employee_id).toBe(chinyere.employee_id);
    expect((await department("People & Culture")).head_employee_id).toBe((await personByTitle("Operations & People Lead")).employee_id);
    expect(pg.head_seat_id).toBe(head[0].org_seat_id);
  }

  test("a roster loaded under the old names is renamed in place, and a second deploy changes nothing", async () => {
    await rebuild(pool, config.DB_NAME);
    const old = path.join(temp, "staff-list-old.xlsx");
    await oldSheet(old);
    const before = await loader.loadStaff({ db: pool, sheet: old, nomenclatureFile: path.join(temp, "none.json"), log: quiet });
    expect(before.status).toBe("loaded");
    const sales = await department("Sales & Marketing");
    const backend = await department("Backend Operations");
    expect(sales).toBeDefined();

    const log = [];
    const after = await loader.loadStaff({ db: pool, log: (m) => log.push(m) });
    expect(after.status).toBe("loaded");
    expect(after.stats.error).toBe(0);
    expect((await department("Branding & Marketing")).department_id).toBe(sales.department_id);
    expect((await department("Technology & Back-office Ops")).department_id).toBe(backend.department_id);
    expect((await department("Technology")).active).toBe(false);
    await expectChartNames();
    expect(log.join("\n")).toMatch(/department "Sales & Marketing" is now "Branding & Marketing"/);

    const again = await loader.loadStaff({ db: pool, log: quiet });
    expect(again.status).toBe("already_loaded");
    expect(Object.values(again.names).every((n) => n === 0)).toBe(true);
    await expectChartNames();
  });

  test("a fresh database loaded from the new sheet ends the same way", async () => {
    await rebuild(pool, config.DB_NAME);
    const result = await loader.loadStaff({ db: pool, log: quiet });
    expect(result.status).toBe("loaded");
    expect(result.stats.error).toBe(0);
    await expectChartNames();
    expect(await department("Technology")).toBeUndefined();
  });

  test("an edit made on screen stays", async () => {
    const bm = await department("Branding & Marketing");
    await q("UPDATE department SET head_employee_id = NULL, head_seat_id = NULL WHERE department_id = $1", [bm.department_id]);
    const someone = await personByTitle("Social Media Manager");
    await q("UPDATE department SET head_employee_id = $2 WHERE department_id = $1", [bm.department_id, someone.employee_id]);
    await q("UPDATE employee SET job_title = 'Graphics Design Associate II' WHERE job_title = 'Graphics Associate'");
    const r = await names.applyNomenclature({ pool, atomically: require("../../src/shared/db/tx").atomically, actor: loader.SYSTEM });
    expect(r).toMatchObject({ heads: 0, titles: 0 });
    expect((await department("Branding & Marketing")).head_employee_id).toBe(someone.employee_id);
  });

  test("a department renamed, a head cleared and the heads' roles set on screen stay after the next deploy, even with new names", async () => {
    const { atomically } = require("../../src/shared/db/tx");
    const organisation = require("../../src/modules/organisation/organisation.service");
    const tx = async (fn) => {
      const client = await pool.connect();
      try {
        return await atomically(client, () => fn(client));
      } finally {
        client.release();
      }
    };
    const bm = await department("Branding & Marketing");
    const pc = await department("People & Culture");
    await tx((client) => organisation.updateDepartment(client, bm.department_id, { name: "Brand & Marketing" }, loader.SYSTEM));
    await tx((client) => organisation.updateDepartment(client, pc.department_id, { head_employee_id: null }, loader.SYSTEM));

    // A new version of the names: a later deploy applies its post changes, never a department or a head.
    const next = JSON.parse(fs.readFileSync(names.FILE, "utf8"));
    next.job_titles = { ...next.job_titles, "Junior Analyst": "Analyst" };
    const file = path.join(temp, "nomenclature-next.json");
    fs.writeFileSync(file, JSON.stringify(next));
    const log = [];
    const again = await loader.loadStaff({ db: pool, log: (m) => log.push(m), nomenclatureFile: file });
    expect(again.status).toBe("already_loaded");
    expect(again.names).toMatchObject({ renamed: 0, created: 0, codes: 0, heads: 0 });
    expect((await department("Brand & Marketing")).department_id).toBe(bm.department_id);
    expect(await department("Branding & Marketing")).toBeUndefined();
    expect((await department("People & Culture")).head_employee_id).toBeNull();

    // The head who is left holds Head of Department; the CEO, who heads General Management, does not need it.
    const head = await rows(
      `SELECT r.code::text AS code FROM user_role ur JOIN role r ON r.role_id = ur.role_id JOIN app_user u ON u.user_id = ur.user_id
        WHERE u.employee_id = $1 AND ur.from_headship`,
      [bm.head_employee_id],
    );
    const holds = await rows(
      `SELECT r.code::text AS code FROM user_role ur JOIN role r ON r.role_id = ur.role_id JOIN app_user u ON u.user_id = ur.user_id
        WHERE u.employee_id = $1`,
      [bm.head_employee_id],
    );
    expect(holds.map((r) => r.code)).toContain("head_of_department");
    expect(head.length).toBeLessThanOrEqual(1);
  });

  test("patterns read a post the way the file writes it", () => {
    expect(names.retitle({ "Marketing & Growth Officer - *": "Growth Officer - *" }, "Marketing & Growth Officer - Cross River")).toBe(
      "Growth Officer - Cross River",
    );
    expect(names.retitle({ "Back-end Manager": "Backend Operations Manager" }, "Back-end Manager")).toBe("Backend Operations Manager");
    expect(names.retitle({ "Back-end Manager": "Backend Operations Manager" }, "Back-end Manager II")).toBeNull();
    expect(names.matcher("Growth Officer - *")("Growth Officer - Kano")).toBe("Kano");
    expect(names.autoCode("Sales & Marketing")).toBe("SALES_MARKETING");
  });
});
