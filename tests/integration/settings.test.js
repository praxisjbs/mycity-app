"use strict";
/**
 * Track C end to end (docs/guides/foundation.md): Roles & Permissions, Organisation,
 * Documents & Numbering, Security and the Audit Log, on the real migrations through
 * HTTP, the outbox drained as the worker would, the email queue captured. The people
 * are invented.
 *
 *   RUN_DB_TESTS=1 DATABASE_URL=postgres://user:pass@127.0.0.1:5432/mycity_test npx jest tests/integration/settings
 *
 * Refuses to run unless the database name ends in "_test": it drops and rebuilds the
 * public schema.
 */
const request = require("supertest");
const { config } = require("../../src/config/env");
const { pool } = require("../../src/config/db");
const { atomically } = require("../../src/shared/db/tx");

const sent = [];
jest.mock("../../src/jobs/queues", () => ({
  enqueue: jest.fn(async (queue, name, data, opts) => {
    sent.push({ queue, name, data, opts });
    return { id: String(sent.length) };
  }),
  getQueue: jest.fn(),
  closeQueues: jest.fn(async () => {}),
  DEFAULTS: {},
}));

const { rebuild } = require("./helpers/schema");
const { createAdmin } = require("../../scripts/db/create-admin");
const { buildApp } = require("../../src/app");
const outbox = require("../../src/shared/events/outbox");
const { emit } = require("../../src/shared/events/emit");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const workingWeek = require("../../src/shared/time/working-week");
const authorise = require("../../src/shared/ai/authorise");
const mfa = require("../../src/modules/security/security.mfa");
const rules = require("../../src/modules/settings/settings.security-rules");

const describeDb = String(config.DB_NAME || "").endsWith("_test") ? describe : describe.skip;

const q = (sql, params) => pool.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];

const PASSWORD = {
  ceo: "Chief#Officer26",
  ops: "Opera!ions2026",
  staff: "Brand-new9Pass",
  viewer: "Viewer#Pass2026",
  admin: "Admin#Pass2026x",
};

async function drain() {
  for (let i = 0; i < 10; i += 1) {
    await q("UPDATE event_outbox SET next_attempt_at = now() WHERE status = 'pending'");
    const r = await outbox.dispatchDue({ db: pool });
    if (r.claimed === 0) return;
  }
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const sidOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url")).sid;

describeDb("access, settings and audit against the real migrations", () => {
  let app;
  const people = {};
  const tokens = {};

  // Each request comes from its own address, so the per-address limits never decide a test.
  let ipSeq = 0;
  const nextIp = () => {
    ipSeq += 1;
    return `10.40.${Math.floor(ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  };
  const as = (who) => {
    const auth = (r) => r.set("Authorization", `Bearer ${tokens[who]}`).set("X-Forwarded-For", nextIp());
    return {
      get: (path) => auth(request(app).get(`/api/v1${path}`)),
      post: (path) => auth(request(app).post(`/api/v1${path}`)),
      put: (path) => auth(request(app).put(`/api/v1${path}`)),
      patch: (path) => auth(request(app).patch(`/api/v1${path}`)),
      delete: (path) => auth(request(app).delete(`/api/v1${path}`)),
    };
  };
  const login = (email, password, agent = request.agent(app)) =>
    agent.post("/api/v1/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password });
  async function signIn(who, email) {
    const res = await login(email, PASSWORD[who]);
    expect(res.status).toBe(200);
    tokens[who] = res.body.access_token;
    return res;
  }

  beforeAll(async () => {
    await rebuild(pool, config.DB_NAME);
    outbox.markReady();
    rules.reset();
    ({ app } = buildApp({ strict: true, accessLog: false }));

    const sample = (first, last, email, job) => ({
      first_name: first,
      last_name: last,
      work_email: email,
      phone: "08031234567",
      job_title: job,
      department_name: "HR & Operations",
      start_date: "2026-01-05",
      employment_type: "full_time",
      work_pattern: "remote",
    });
    const make = (client, who, first, last, email, job, role_code, is_ceo = false) =>
      createAdmin(client, { employee: sample(first, last, email, job), role_code, is_ceo }, PASSWORD[who], {
        allowAdditional: true,
      });
    await tx(async (client) => {
      people.ceo = await make(client, "ceo", "Amaka", "Eze", "ceo@mycity.test", "Chief Executive Officer", "management", true);
      people.ops = await make(client, "ops", "Ada", "Obi", "ops@mycity.test", "Operations & People Lead", "operations_people");
      people.staff = await make(client, "staff", "Bola", "Ade", "bola@mycity.test", "Content Associate", "employee");
      people.viewer = await make(client, "viewer", "Chidi", "Nwosu", "chidi@mycity.test", "Program Manager", "management");
      people.admin = await make(client, "admin", "Femi", "Bello", "femi@mycity.test", "Systems Officer", "administrator");
    });
    await drain();
    await signIn("ceo", "ceo@mycity.test");
    await signIn("ops", "ops@mycity.test");
    await signIn("staff", "bola@mycity.test");
    await signIn("viewer", "chidi@mycity.test");
    await signIn("admin", "femi@mycity.test");
  });

  afterAll(async () => {
    await require("../../src/shared/observability/error-reporter").flush();
    await pool.end();
  });

  /* ------------------------------------------------------------------ */

  describe("roles and permissions", () => {
    let studio;

    test("the seven roles, with what each grants and how many hold it", async () => {
      const res = await as("ops").get("/settings/roles");
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBe(7);
      const byCode = Object.fromEntries(res.body.data.map((r) => [r.code, r]));
      expect(byCode.operations_people).toEqual(
        expect.objectContaining({ is_system: true, users: 1, modules: 16, scope: "all", fields_visible: 4 }),
      );
      expect(byCode.employee).toEqual(expect.objectContaining({ users: 1, scope: "own", fields_visible: 0 }));
      expect(res.body.data[0].code).toBe("implementation");
    });

    test("the catalogue and the matrix: every module, every role", async () => {
      const cat = await as("ops").get("/settings/roles/catalogue");
      expect(cat.status).toBe(200);
      expect(cat.body.modules).toHaveLength(18);
      expect(cat.body.modules.find((m) => m.key === "ess").own_only).toBe(true);
      expect(cat.body.fields.map((f) => f.key)).toEqual([
        "employee.salary",
        "employee.bank",
        "employee.personal",
        "employee.statutory",
      ]);
      expect(cat.body.capabilities.map((c) => c.code)).toEqual([
        "alerts.clear",
        "alerts.manage",
        "announcements.post",
        "home.reports",
        "home.team",
        "mailbox.signature",
        "policies.manage",
      ]);

      const m = await as("ops").get("/settings/roles/matrix");
      expect(m.status).toBe(200);
      expect(m.body.roles).toHaveLength(7);
      expect(m.body.rows).toHaveLength(18);
      const payroll = m.body.rows.find((r) => r.module_key === "payroll");
      const staffRole = m.body.roles.findIndex((r) => r.code === "employee");
      expect(payroll.cells[staffRole]).toEqual(expect.objectContaining({ actions: [], scope: null }));
    });

    test("the Implementation Team holds everything there is, so training runs from the build account", async () => {
      /* TB, 19/10/2026 (docs/guides/identity.md §8): a module, capability or field added later goes to it too. */
      const catalog = require("../../src/shared/access/access.catalog");
      const { FIELD_KEYS } = require("../../src/shared/rbac/field-mask");
      const { rows: grants } = await q(
        `SELECT p.module_key::text AS module_key, p.scope::text AS scope, p.can_view, p.can_create, p.can_edit,
                p.can_delete, p.can_approve, p.can_export
           FROM permission p JOIN role r ON r.role_id = p.role_id
          WHERE r.code = 'implementation'
          ORDER BY p.module_key`,
      );
      expect(grants.map((g) => g.module_key)).toEqual([...catalog.MODULES].sort());
      /* Self-Service and the Mailbox are a person's own whatever a grant says, so they read own. */
      const ownOnly = new Set([...catalog.OWN_ONLY, "mailbox"]);
      for (const g of grants)
        expect(g).toEqual({
          module_key: g.module_key,
          scope: ownOnly.has(g.module_key) ? "own" : "all",
          can_view: true,
          can_create: true,
          can_edit: true,
          can_delete: true,
          can_approve: true,
          can_export: true,
        });
      const { rows: capabilities } = await q(
        `SELECT c.code::text AS code FROM role_capability rc
           JOIN role r ON r.role_id = rc.role_id JOIN capability c ON c.capability_id = rc.capability_id
          WHERE r.code = 'implementation' ORDER BY 1`,
      );
      expect(capabilities.map((r) => r.code)).toEqual([...catalog.CAPABILITIES].sort());
      const { rows: fields } = await q(
        `SELECT f.field_key, f.visibility FROM field_visibility f JOIN role r ON r.role_id = f.role_id
          WHERE r.code = 'implementation' ORDER BY 1`,
      );
      const keys = FIELD_KEYS.map((f) => f.key).sort();
      expect(fields).toEqual(keys.map((field_key) => ({ field_key, visibility: "visible" })));
    });

    test("the §6.3 defaults: fields and capabilities for Operations, Management and the build team", async () => {
      const roles = (await as("ops").get("/settings/roles")).body.data;
      const detail = async (code) =>
        (await as("ops").get(`/settings/roles/${roles.find((r) => r.code === code).role_id}`)).body;
      const ops = await detail("operations_people");
      expect(ops.visible_fields).toHaveLength(4);
      expect(ops.capabilities).toEqual(["alerts.clear", "alerts.manage", "announcements.post", "home.reports", "home.team", "policies.manage"]);
      const staff = await detail("employee");
      expect(staff.visible_fields).toEqual([]);
      expect(staff.capabilities).toEqual([]);

      expect(await grantsCache.getMaskedFieldKeys(pool, people.staff.user.user_id)).toEqual([
        "employee.bank",
        "employee.personal",
        "employee.salary",
        "employee.statutory",
      ]);
      expect(await grantsCache.getMaskedFieldKeys(pool, people.ops.user.user_id)).toEqual([]);
      expect(await grantsCache.getCapabilities(pool, people.ops.user.user_id)).toEqual([
        "alerts.clear",
        "alerts.manage",
        "announcements.post",
        "home.reports",
        "home.team",
        "policies.manage",
      ]);
      expect(await grantsCache.getCapabilities(pool, people.staff.user.user_id)).toEqual([]);
    });

    test("only Settings view reads them; only Settings create makes one", async () => {
      expect((await as("staff").get("/settings/roles")).status).toBe(403);
      expect((await as("viewer").get("/settings/roles")).status).toBe(200);
      const body = { name: "Viewer Made", grants: [{ module_key: "home", scope: "own", actions: ["view"] }], visible_fields: [], capabilities: [] };
      expect((await as("viewer").post("/settings/roles").send(body)).status).toBe(403);
    });

    test("a custom role is created whole, and the change is a security event the watchers hear of", async () => {
      const res = await as("ops").post("/settings/roles").send({
        name: "Studio Lead",
        description: "Runs the studio",
        grants: [
          { module_key: "people", scope: "team", actions: ["view", "approve"] },
          { module_key: "ess", scope: "all", actions: ["view", "create", "edit"] },
        ],
        visible_fields: ["employee.salary"],
        capabilities: ["announcements.post"],
      });
      expect(res.status).toBe(201);
      studio = res.body;
      expect(studio.code).toBe("studio_lead");
      expect(studio.is_system).toBe(false);
      expect(studio.home_view).toBe("staff");
      expect(studio.grants).toEqual([
        { module_key: "ess", scope: "own", actions: ["view", "create", "edit"] },
        { module_key: "people", scope: "team", actions: ["view", "approve"] },
      ]);
      expect(studio.visible_fields).toEqual(["employee.salary"]);
      expect(studio.capabilities).toEqual(["announcements.post"]);

      const audit = await one(
        "SELECT is_sensitive, after FROM audit_ledger WHERE action = 'role.created' AND entity_id = $1",
        [studio.role_id],
      );
      expect(audit.is_sensitive).toBe(true);
      expect(audit.after.grants.people).toBe("view, approve · team");
      await drain();
      const told = await one(
        `SELECT count(*)::int AS n FROM notification n
          WHERE n.event_key = 'role.created' AND n.user_id = $1 AND n.category = 'security'`,
        [people.ceo.user.user_id],
      );
      expect(told.n).toBe(1);
    });

    test("names are unique, and a built-in role keeps its name", async () => {
      const dup = await as("ops").post("/settings/roles").send({
        name: "studio lead",
        grants: [{ module_key: "home", scope: "own", actions: ["view"] }],
        visible_fields: [],
        capabilities: [],
      });
      expect(dup.status).toBe(409);
      expect(dup.body.error.fields).toEqual({ name: ["Name already used"] });

      const roles = (await as("ops").get("/settings/roles")).body.data;
      const mgr = roles.find((r) => r.code === "manager");
      const detail = (await as("ops").get(`/settings/roles/${mgr.role_id}`)).body;
      const res = await as("ops").put(`/settings/roles/${mgr.role_id}`).send({
        name: "Team Lead",
        grants: detail.grants,
        visible_fields: detail.visible_fields,
        capabilities: detail.capabilities,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toEqual({ name: ["Built-in name stays"] });
    });

    test("each part that changed is its own event: grants, fields, capabilities", async () => {
      const res = await as("ops").put(`/settings/roles/${studio.role_id}`).send({
        name: "Studio Lead",
        description: "Runs the studio",
        grants: [{ module_key: "people", scope: "all", actions: ["view"] }],
        visible_fields: ["employee.salary", "employee.bank"],
        capabilities: [],
      });
      expect(res.status).toBe(200);
      expect(res.body.grants).toEqual([{ module_key: "people", scope: "all", actions: ["view"] }]);
      const keys = (
        await q("SELECT action FROM audit_ledger WHERE entity_id = $1 ORDER BY occurred_at, action", [studio.role_id])
      ).rows.map((r) => r.action);
      expect(keys).toEqual(
        expect.arrayContaining(["role.created", "permission.changed", "field_visibility.changed", "capability.changed"]),
      );
      expect(keys).not.toContain("role.updated");
      const perm = await one(
        "SELECT before, after, changed_fields FROM audit_ledger WHERE action = 'permission.changed' AND entity_id = $1",
        [studio.role_id],
      );
      expect(perm.changed_fields).toEqual(["ess", "people"]);
    });

    test("a change reaches the next request: the grants cache is cleared", async () => {
      expect((await as("staff").get("/settings/organisation")).status).toBe(403);
      const roles = (await as("ops").get("/settings/roles")).body.data;
      const staffRole = roles.find((r) => r.code === "employee");
      const before = (await as("ops").get(`/settings/roles/${staffRole.role_id}`)).body;
      const save = (grants) =>
        as("ops").put(`/settings/roles/${staffRole.role_id}`).send({
          name: before.name,
          description: before.description,
          grants,
          visible_fields: before.visible_fields,
          capabilities: before.capabilities,
        });
      expect((await save([...before.grants, { module_key: "settings", scope: "own", actions: ["view"] }])).status).toBe(200);
      expect((await as("staff").get("/settings/organisation")).status).toBe(200);
      expect((await save(before.grants)).status).toBe(200);
      expect((await as("staff").get("/settings/organisation")).status).toBe(403);
    });

    test("roles add up: one role that shows a field shows it", async () => {
      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee", "studio_lead"], null);
      });
      expect(await grantsCache.getMaskedFieldKeys(pool, people.staff.user.user_id)).toEqual([
        "employee.personal",
        "employee.statutory",
      ]);
      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee"], null);
      });
    });

    test("nobody but the CEO can take away their own Settings edit", async () => {
      const roles = (await as("ops").get("/settings/roles")).body.data;
      const opsRole = roles.find((r) => r.code === "operations_people");
      const d = (await as("ops").get(`/settings/roles/${opsRole.role_id}`)).body;
      const res = await as("ops").put(`/settings/roles/${opsRole.role_id}`).send({
        name: d.name,
        description: d.description,
        grants: d.grants.map((g) => (g.module_key === "settings" ? { ...g, actions: ["view"] } : g)),
        visible_fields: d.visible_fields,
        capabilities: d.capabilities,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("LOCKOUT");
    });

    test("a role somebody holds, or a built-in one, cannot be deleted; an unused custom one can", async () => {
      const roles = (await as("ops").get("/settings/roles")).body.data;
      const staffRole = roles.find((r) => r.code === "employee");
      expect((await as("ops").delete(`/settings/roles/${staffRole.role_id}`)).status).toBe(409);

      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee", "studio_lead"], null);
      });
      const held = await as("ops").delete(`/settings/roles/${studio.role_id}`);
      expect(held.status).toBe(409);
      expect(held.body.error.code).toBe("ROLE_IN_USE");
      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee"], null);
      });

      expect((await as("ops").delete(`/settings/roles/${studio.role_id}`)).status).toBe(204);
      expect((await as("ops").get(`/settings/roles/${studio.role_id}`)).status).toBe(404);
      expect((await as("ops").get("/settings/roles")).body.page.total).toBe(7);
      const again = await as("ops").post("/settings/roles").send({
        name: "Studio Lead",
        grants: [{ module_key: "home", scope: "own", actions: ["view"] }],
        visible_fields: [],
        capabilities: [],
      });
      expect(again.status).toBe(201);
      expect(again.body.code).toBe("studio_lead_2");
      expect((await as("ops").delete(`/settings/roles/${again.body.role_id}`)).status).toBe(204);
    });

    test("the assistant reads roles only for people who can open Settings", async () => {
      const staffUser = await grantsCache.getAuthUser(pool, people.staff.user.user_id);
      await expect(authorise.runRead(pool, staffUser, "roles.list", {})).rejects.toMatchObject({
        code: "AI_READ_FORBIDDEN",
      });
      const opsUser = await grantsCache.getAuthUser(pool, people.ops.user.user_id);
      const r = await authorise.runRead(pool, opsUser, "roles.list", {});
      expect(r.page.total).toBe(7);
      expect(r.citations[0]).toEqual(expect.objectContaining({ type: "role" }));
    });
  });

  /* ------------------------------------------------------------------ */

  describe("organisation, working week and holidays", () => {
    test("the profile starts empty, is entered on screen, and is audited", async () => {
      const empty = await as("ops").get("/settings/organisation");
      expect(empty.status).toBe(200);
      expect(empty.body).toEqual(
        expect.objectContaining({ legal_name: null, trading_name: null, currency: "NGN", time_zone: "Africa/Lagos" }),
      );
      const res = await as("ops").patch("/settings/organisation").send({
        legal_name: "MyCity App Ltd",
        trading_name: "MyCityApp",
        email: "Hello@MyCity.test",
        phone: "0803 123 4567",
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({ legal_name: "MyCity App Ltd", email: "hello@mycity.test", phone: "+2348031234567" }),
      );
      const cleared = await as("ops").patch("/settings/organisation").send({ trading_name: "" });
      expect(cleared.body.trading_name).toBeNull();
      const audit = await one(
        "SELECT before, after FROM audit_ledger WHERE action = 'settings.changed' AND entity_id = 'organisation' ORDER BY occurred_at LIMIT 1",
      );
      expect(audit.before.legal_name).toBeNull();
      expect(audit.after.legal_name).toBe("MyCity App Ltd");
      expect((await as("viewer").patch("/settings/organisation").send({ legal_name: "X Ltd" })).status).toBe(403);
    });

    test("brand files: each takes a PNG at once, letters and system mail draw it, Remove brings the name back", async () => {
      const sharp = require("sharp");
      const documents = require("../../src/shared/documents/generate");
      const systemMail = require("../../src/services/mail/system-mail.service");
      const png = (r, g, b) =>
        sharp({ create: { width: 400, height: 100, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
      const upload = (slot, buffer, name) =>
        as("ops").post(`/settings/organisation/brand/${slot}`).field("purpose", "brand").attach("file", buffer, name);

      const logo = await upload("logo", await png(1, 67, 57), "logo.png");
      expect(logo.status).toBe(201);
      expect(logo.body).toMatchObject({ file_name: "logo.png", mime_type: "image/png" });
      const jpeg = await sharp({ create: { width: 40, height: 10, channels: 3, background: { r: 1, g: 67, b: 57 } } }).jpeg().toBuffer();
      expect((await upload("icon", jpeg, "icon.jpg")).status).toBe(415);
      expect((await as("viewer").post("/settings/organisation/brand/logo").field("purpose", "brand").attach("file", await png(0, 0, 0), "x.png")).status).toBe(403);
      expect((await as("ops").post("/settings/organisation/brand/banner").field("purpose", "brand").attach("file", await png(0, 0, 0), "x.png")).status).toBe(422);

      // Letters: the Logo, fitted to the letterhead's 40 px at four times for print.
      let org = await documents.orgProfile(pool);
      expect(org).toMatchObject({ name: "MyCity App Ltd", display_name: "MyCity App Ltd", logo_white: null });
      const drawn = await sharp(Buffer.from(org.logo.split(",")[1], "base64")).metadata();
      expect([drawn.format, drawn.width, drawn.height]).toEqual(["png", 640, 160]);

      // System mail: the White Logo inside the message, a data: URL in a preview.
      const white = await upload("logo_white", await png(255, 255, 255), "white.png");
      expect(white.status).toBe(201);
      expect((await as("ops").get("/settings/organisation")).body).toMatchObject({
        logo: { document_id: logo.body.document_id },
        logo_white: { document_id: white.body.document_id },
        icon: null,
      });
      const data = { link_url: "https://hub.mycityapp.io/reset?token=abc", minutes: 30 };
      const recipient = { first_name: "Ada", email: "ada@mycity.test" };
      const mailed = await systemMail.renderEmail(pool, "password-reset", data, { recipient, inline: true });
      expect(mailed.html).toContain('src="cid:brand-logo@mycityapp.io" width="112" height="28" alt="MyCity App Ltd"');
      expect(mailed.inline).toEqual([expect.objectContaining({ cid: "brand-logo@mycityapp.io", contentType: "image/png" })]);
      const preview = await systemMail.renderEmail(pool, "password-reset", data, { recipient });
      expect(preview.html).toContain('src="data:image/png;base64,');
      expect(preview.inline).toEqual([]);

      const removed = await as("ops").delete("/settings/organisation/brand/logo_white");
      expect(removed.status).toBe(200);
      expect(removed.body.logo_white).toBeNull();
      org = await documents.orgProfile(pool);
      expect(org.logo_white).toBeNull();
      const plain = await systemMail.renderEmail(pool, "password-reset", data, { recipient, inline: true });
      expect(plain.html).toContain('color:#FFFFFF;">MyCity App Ltd</span>');
      expect(plain.inline).toEqual([]);
      const audit = await one(
        "SELECT after FROM audit_ledger WHERE action = 'settings.changed' AND after ? 'logo_white_document_id' ORDER BY occurred_at DESC LIMIT 1",
      );
      expect(audit.after.logo_white_document_id).toBeNull();
    });

    test("A22: Monday to Friday 09:00 to 17:00, Saturday 09:00 to 15:00, Sunday off", async () => {
      const res = await as("ops").get("/settings/working-week");
      expect(res.status).toBe(200);
      expect(res.body.days.map((d) => [d.weekday, d.is_working_day, d.starts_at, d.ends_at])).toEqual([
        [1, true, "09:00", "17:00"],
        [2, true, "09:00", "17:00"],
        [3, true, "09:00", "17:00"],
        [4, true, "09:00", "17:00"],
        [5, true, "09:00", "17:00"],
        [6, true, "09:00", "15:00"],
        [7, false, null, null],
      ]);
    });

    test("the week is changed per day, checked, and read by the working calendar", async () => {
      const week = (await as("ops").get("/settings/working-week")).body.days;
      const friday = week.map((d) => (d.weekday === 5 ? { ...d, ends_at: "16:00" } : d));
      const res = await as("ops").put("/settings/working-week").send({ days: friday });
      expect(res.status).toBe(200);
      expect(res.body.days[4].ends_at).toBe("16:00");
      const cal = await workingWeek.loadCalendar(pool);
      expect(cal.hours[5]).toEqual({ starts_at: "09:00", ends_at: "16:00" });

      const bad = week.map((d) => (d.weekday === 2 ? { ...d, starts_at: "17:00", ends_at: "09:00" } : d));
      const refused = await as("ops").put("/settings/working-week").send({ days: bad });
      expect(refused.status).toBe(422);
      expect((await as("ops").put("/settings/working-week").send({ days: week })).status).toBe(200);
    });

    test("Nigeria's holidays are seeded, the moon-dated and weekend ones expected until confirmed", async () => {
      const in2026 = (await as("ops").get("/settings/holidays?year=2026")).body;
      expect(in2026.page.total).toBe(14);
      const byDate = Object.fromEntries(in2026.data.map((h) => [h.holiday_date, h]));
      expect(byDate["2026-10-01"]).toEqual(expect.objectContaining({ name: "Independence Day", expected: false }));
      expect(byDate["2026-03-20"]).toEqual(expect.objectContaining({ name: "Eid-el-Fitr", expected: true }));
      const in2027 = (await as("ops").get("/settings/holidays?year=2027")).body;
      expect(in2027.page.total).toBe(19);
      const cal = await workingWeek.loadCalendar(pool);
      expect(cal.holidays.has("2026-12-25")).toBe(true);
      expect(cal.holidays.has("2027-03-09")).toBe(true);
    });

    test("holidays are added on screen, one a date, and saving an expected one confirms it", async () => {
      const add = await as("ops").post("/settings/holidays").send({ holiday_date: "2026-11-02", name: "Election Day" });
      expect(add.status).toBe(201);
      expect(add.body.expected).toBe(false);
      const twice = await as("ops").post("/settings/holidays").send({ holiday_date: "2026-10-01", name: "Again" });
      expect(twice.status).toBe(409);
      expect(twice.body.error.fields).toEqual({ holiday_date: ["Already a holiday"] });
      expect((await workingWeek.loadCalendar(pool)).holidays.has("2026-11-02")).toBe(true);

      const eid = (await as("ops").get("/settings/holidays?year=2027")).body.data.find((h) => h.holiday_date === "2027-03-09");
      const confirmed = await as("ops")
        .patch(`/settings/holidays/${eid.public_holiday_id}`)
        .send({ holiday_date: "2027-03-09", name: "Eid-el-Fitr" });
      expect(confirmed.status).toBe(200);
      expect(confirmed.body.expected).toBe(false);
      const audit = await one(
        "SELECT before, after FROM audit_ledger WHERE action = 'settings.changed' AND entity_id = $1",
        [eid.public_holiday_id],
      );
      expect(audit.before.expected).toBe(true);
      expect(audit.after.expected).toBe(false);

      const moved = await as("ops")
        .patch(`/settings/holidays/${add.body.public_holiday_id}`)
        .send({ holiday_date: "2026-11-03", name: "Election Day" });
      expect(moved.status).toBe(200);
      expect(moved.body.holiday_date).toBe("2026-11-03");
      expect((await as("ops").delete(`/settings/holidays/${add.body.public_holiday_id}`)).status).toBe(204);
      expect((await as("ops").get("/settings/holidays?year=2026")).body.page.total).toBe(14);

      const staffUser = await grantsCache.getAuthUser(pool, people.staff.user.user_id);
      const r = await authorise.runRead(pool, staffUser, "holidays.list", { year: 2026 });
      expect(r.data[0]).toEqual(expect.objectContaining({ name: "New Year's Day", holiday_date: "2026-01-01" }));
    });
  });

  /* ------------------------------------------------------------------ */

  describe("numbering", () => {
    test("every numbered document type, with the next number it would give", async () => {
      const res = await as("ops").get("/settings/numbering");
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBe(21);
      const expense = res.body.data.find((s) => s.doc_type === "expense");
      expect(expense).toEqual(expect.objectContaining({ label: "Expense Request", prefix: "EXP", next: "EXP-0001", issued: 0 }));
      const staff = res.body.data.find((s) => s.doc_type === "employee");
      // Five staff numbers were issued to the people this test made.
      expect(staff.next).toBe("00006");
      const found = await as("ops").get("/settings/numbering?q=payslip");
      expect(found.body.data.map((s) => s.doc_type)).toEqual(["payslip"]);
      const summary = await as("ops").get("/settings/numbering/summary");
      expect(summary.body).toEqual(expect.objectContaining({ types: 20, resetting: 2 }));
    });

    test("a scheme changes the next number, never one issued; a reset needs its period", async () => {
      const res = await as("ops")
        .put("/settings/numbering/expense")
        .send({ prefix: "exr", padding: 5, separator: "-", reset: "never", include_period: false });
      expect(res.status).toBe(200);
      expect(res.body.next).toBe("EXR-00001");

      const reset = await as("ops")
        .put("/settings/numbering/expense")
        .send({ prefix: "EXR", padding: 5, separator: "-", reset: "yearly", include_period: false });
      expect(reset.status).toBe(422);
      expect(reset.body.error.fields).toEqual({ include_period: ["Needed when it resets"] });

      const yearly = await as("ops")
        .put("/settings/numbering/expense")
        .send({ prefix: "EXR", padding: 4, separator: "-", reset: "yearly", include_period: true });
      expect(yearly.body.next).toMatch(/^EXR-20\d\d-0001$/);
      expect((await as("ops").put("/settings/numbering/ledger").send({ prefix: "L", padding: 4, separator: "-", reset: "never", include_period: false })).status).toBe(422);
      const audit = await one(
        "SELECT count(*)::int AS n FROM audit_ledger WHERE action = 'settings.changed' AND entity_type = 'numbering_scheme'",
      );
      expect(audit.n).toBe(2);
    });
  });

  /* ------------------------------------------------------------------ */

  describe("security rules within the .env floor", () => {
    test("the rules in force, their floors, two-step by role and the figures", async () => {
      const res = await as("ops").get("/settings/security");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          session_max_age_min: 120,
          session_max_age_floor: 120,
          idle_lock_min: 30,
          idle_lock_floor: 30,
          password_min_length: 8,
          password_min_floor: 8,
          users: 5,
          two_step_on: 0,
        }),
      );
      expect(res.body.active_sessions).toBeGreaterThanOrEqual(5);
      expect(res.body.two_step_roles).toHaveLength(7);
    });

    test("a rule looser than its floor is refused with the floor named", async () => {
      const res = await as("ops").patch("/settings/security").send({ session_max_age_min: 180, idle_lock_min: 45 });
      expect(res.status).toBe(422);
      expect(res.body.error.fields).toEqual({
        session_max_age_min: ["At most 120 minutes"],
        idle_lock_min: ["At most 30 minutes"],
      });
      const short = await as("ops").patch("/settings/security").send({ password_min_length: 7 });
      expect(short.status).toBe(422);
      expect(short.body.error.fields).toEqual({ password_min_length: ["At least 8"] });
    });

    test("tighter rules apply to the next sign-in and the next password, and the watchers hear", async () => {
      const res = await as("ops")
        .patch("/settings/security")
        .send({ session_max_age_min: 60, idle_lock_min: 15, password_min_length: 12 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ session_max_age_min: 60, idle_lock_min: 15, password_min_length: 12 }));

      const signedIn = await login("bola@mycity.test", PASSWORD.staff);
      expect(signedIn.body.session_max_age).toBe(3600);
      expect(signedIn.body.session_idle_limit).toBe(900);
      tokens.staff = signedIn.body.access_token;

      const short = await as("staff")
        .post("/auth/password")
        .send({ current_password: PASSWORD.staff, new_password: "Short-pas9!" });
      expect(short.status).toBe(422);
      expect(short.body.error.fields).toEqual({ new_password: ["At least 12 characters"] });

      const audit = await one("SELECT is_sensitive, before, after FROM audit_ledger WHERE action = 'settings.security_changed'");
      expect(audit.is_sensitive).toBe(true);
      expect(audit.before.session_max_age_min).toBe(120);
      expect(audit.after.session_max_age_min).toBe(60);
      await drain();
      const told = await one(
        "SELECT count(*)::int AS n FROM notification WHERE event_key = 'settings.security_changed' AND user_id = $1",
        [people.ceo.user.user_id],
      );
      expect(told.n).toBe(1);

      const back = await as("ops")
        .patch("/settings/security")
        .send({ session_max_age_min: 120, idle_lock_min: 30, password_min_length: 8 });
      expect(back.status).toBe(200);
    });

    test("a role that requires two-step makes its people set it up at their next sign-in", async () => {
      const on = await as("ops").patch("/settings/security").send({ two_step_roles: ["employee"] });
      expect(on.status).toBe(200);
      expect(on.body.two_step_roles.find((r) => r.code === "employee").two_step_required).toBe(true);

      const agent = request.agent(app);
      const first = await login("bola@mycity.test", PASSWORD.staff, agent);
      expect(first.status).toBe(200);
      expect(first.body).toEqual(expect.objectContaining({ step: "setup", expires_in: 900 }));
      expect(first.body.access_token).toBeUndefined();

      const setup = await agent
        .post("/api/v1/auth/two-step/setup")
        .set("X-Forwarded-For", nextIp())
        .send({ challenge_token: first.body.challenge_token });
      expect(setup.status).toBe(200);
      const key = setup.body.secret.replace(/ /g, "");

      const wrong = mfa.codeAt(key) === "000000" ? "111111" : "000000";
      const refused = await agent
        .post("/api/v1/auth/two-step/enrol")
        .set("X-Forwarded-For", nextIp())
        .send({ challenge_token: first.body.challenge_token, code: wrong });
      expect(refused.status).toBe(401);

      const enrolled = await agent
        .post("/api/v1/auth/two-step/enrol")
        .set("X-Forwarded-For", nextIp())
        .send({ challenge_token: first.body.challenge_token, code: mfa.codeAt(key) });
      expect(enrolled.status).toBe(200);
      expect(enrolled.body.recovery_codes).toHaveLength(10);
      expect(enrolled.body.user.email).toBe("bola@mycity.test");
      tokens.staff = enrolled.body.access_token;
      const method = await one("SELECT method FROM user_session WHERE session_id = $1", [sidOf(tokens.staff)]);
      expect(method.method).toBe("password_totp");

      const replay = await agent
        .post("/api/v1/auth/two-step/enrol")
        .set("X-Forwarded-For", nextIp())
        .send({ challenge_token: first.body.challenge_token, code: mfa.codeAt(key) });
      expect(replay.status).toBeGreaterThanOrEqual(400);

      const mine = await as("staff").get("/security");
      expect(mine.body.two_step).toEqual(expect.objectContaining({ on: true, required: true }));
      const off = await as("staff").post("/security/two-step/off").send({});
      expect(off.status).toBe(422);
      expect(off.body.error.code).toBe("TWO_STEP_REQUIRED");

      // Set up, the next sign-in on another browser asks for the code as usual.
      const next = await login("bola@mycity.test", PASSWORD.staff);
      expect(next.body.step).toBe("code");

      const offAgain = await as("ops").patch("/settings/security").send({ two_step_roles: [] });
      expect(offAgain.body.two_step_roles.every((r) => !r.two_step_required)).toBe(true);
      expect(offAgain.body.two_step_on).toBe(1);
    });

    test("failed sign-ins are listed newest first, with who and why", async () => {
      await login("ops@mycity.test", "not-the-password");
      await login("nobody@mycity.test", "whatever");
      const res = await as("ops").get("/settings/security/failed-logins");
      expect(res.status).toBe(200);
      const [latest, before] = res.body.data;
      expect(latest).toEqual(expect.objectContaining({ email: "nobody@mycity.test", reason: "no_such_account", display_name: null }));
      expect(before).toEqual(expect.objectContaining({ email: "ops@mycity.test", reason: "bad_password", display_name: "Ada Obi" }));
      await q("UPDATE app_user SET failed_login_count = 0, last_failed_login_at = NULL");
      const found = await as("ops").get("/settings/security/failed-logins?q=nobody");
      expect(found.body.page.total).toBe(1);
    });

    test("everyone's live sessions, and ending one remotely", async () => {
      const res = await as("ops").get("/settings/security/sessions");
      expect(res.status).toBe(200);
      const mine = res.body.data.find((s) => s.session_id === sidOf(tokens.ops));
      expect(mine.current).toBe(true);
      const own = await as("ops").post(`/settings/security/sessions/${sidOf(tokens.ops)}/end`).send({});
      expect(own.status).toBe(422);

      const viewer = sidOf(tokens.viewer);
      expect(res.body.data.some((s) => s.session_id === viewer)).toBe(true);
      expect((await as("viewer").post(`/settings/security/sessions/${viewer}/end`).send({})).status).toBe(403);
      expect((await as("ops").post(`/settings/security/sessions/${viewer}/end`).send({})).status).toBe(204);
      expect((await as("viewer").get("/settings/roles")).status).toBe(401);
      const ended = await one("SELECT end_reason FROM user_session WHERE session_id = $1", [viewer]);
      expect(ended.end_reason).toBe("ended_by_admin");
      expect((await as("ops").post(`/settings/security/sessions/${viewer}/end`).send({})).status).toBe(404);
      await signIn("viewer", "chidi@mycity.test");
    });
  });

  /* ------------------------------------------------------------------ */

  describe("the audit log", () => {
    beforeAll(async () => {
      // A change to someone's pay, as the people module will record it.
      await tx((client) =>
        emit(client, {
          key: "settings.changed",
          entity: { type: "employee", id: people.staff.employee.employee_id },
          actor: people.ops.user.user_id,
          before: { gross_monthly: "450000.00", job_title: "Content Associate" },
          after: { gross_monthly: "500000.00", job_title: "Content Associate" },
        }),
      );
    });

    test("the whole log, newest first, filtered", async () => {
      const res = await as("ops").get("/audit");
      expect(res.status).toBe(200);
      expect(res.body.page.total).toBeGreaterThan(10);
      const times = res.body.data.map((e) => e.occurred_at);
      expect([...times].sort().reverse()).toEqual(times);

      const roles = await as("ops").get("/audit?action=role.created");
      expect(roles.body.data.every((e) => e.action === "role.created" && e.summary === "A role was created")).toBe(true);
      expect(roles.body.data[0].link).toMatch(/^\/settings\?tab=roles-and-permissions&id=/);

      const byActor = await as("ops").get(`/audit?actor_user_id=${people.ops.user.user_id}&module=settings`);
      expect(byActor.body.data.every((e) => e.actor_user_id === people.ops.user.user_id)).toBe(true);
      const today = new Date().toISOString().slice(0, 10);
      const dated = await as("ops").get(`/audit?from=2020-01-01&to=2020-01-31`);
      expect(dated.body.page.total).toBe(0);
      expect((await as("ops").get(`/audit?from=${today}`)).status).toBe(200);
      const searched = await as("ops").get("/audit?q=Studio");
      expect(searched.status).toBe(200);
    });

    test("restricted values are masked for a reader whose roles mask them, and named", async () => {
      const path = `/audit?entity_type=employee&entity_id=${people.staff.employee.employee_id}&action=settings.changed`;
      const admin = await as("admin").get(path);
      expect(admin.status).toBe(200);
      const [entry] = admin.body.data;
      expect(entry.after.gross_monthly).toBeNull();
      expect(entry.after.job_title).toBe("Content Associate");
      expect(entry.masked).toEqual(["gross_monthly"]);

      const ops = await as("ops").get(path);
      expect(ops.body.data[0].after.gross_monthly).toBe("500000.00");
      expect(ops.body.data[0].masked).toEqual([]);
    });

    test("only Settings view over everything, and the CEO, read it", async () => {
      expect((await as("staff").get("/audit")).status).toBe(403);
      expect((await as("ceo").get("/audit")).status).toBe(200);
      const roles = (await as("ops").get("/settings/roles")).body.data;
      const studio = await as("ops").post("/settings/roles").send({
        name: "Team Auditor",
        grants: [{ module_key: "settings", scope: "team", actions: ["view"] }],
        visible_fields: [],
        capabilities: [],
      });
      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee", studio.body.code], null);
      });
      expect((await as("staff").get("/audit")).status).toBe(403);
      expect((await as("staff").get("/audit/summary")).status).toBe(403);
      await tx(async (client) => {
        const access = require("../../src/modules/access/access.service");
        await access.setRoles(client, people.staff.user.user_id, ["employee"], null);
      });
      expect(roles.length).toBe(7);
    });

    test("the summary: today, this week, this month, by module", async () => {
      const res = await as("ops").get("/audit/summary");
      expect(res.status).toBe(200);
      expect(res.body.today).toBeGreaterThan(0);
      expect(res.body.this_month).toBeGreaterThanOrEqual(res.body.today);
      expect(res.body.by_module[0]).toEqual(expect.objectContaining({ module_key: "settings", label: "Settings" }));
      expect(res.body.modules).toHaveLength(18);
    });

    test("the export is the whole filtered log, made by the worker into the file the Audit Log downloads", async () => {
      expect((await as("viewer").post("/audit/exports").send({ module: "settings" })).status).toBe(202);
      const res = await as("admin").post("/audit/exports").send({ action: "settings.changed" });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ document_id: expect.any(String), file_name: expect.stringMatching(/^audit-log-.+\.xlsx$/), status: "pending" });
      expect((await as("staff").post("/audit/exports").send({})).status).toBe(403);

      sent.length = 0;
      await drain();
      // Nothing is emailed: the screen that asked downloads the file.
      expect(sent.filter((s) => s.queue === "email-send")).toEqual([]);
      const file = await as("admin").get(`/exports/${res.body.document_id}`);
      expect(file.body).toEqual({ ...res.body, status: "done" });
      const doc = await one("SELECT doc_type, sensitivity, mime, uploaded_by FROM document WHERE document_id = $1", [res.body.document_id]);
      expect(doc).toEqual({
        doc_type: "audit_export",
        sensitivity: "restricted",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        uploaded_by: people.admin.user.user_id,
      });
      const content = await as("admin")
        .get(`/documents/${res.body.document_id}/content`)
        .buffer(true)
        .parse((stream, done) => {
          const chunks = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(content.status).toBe(200);
      // Its cover says what it holds: the filters, and how many entries.
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(content.body);
      const cover = [];
      wb.getWorksheet("Cover").eachRow((row) => cover.push(row.values.slice(1).join(" ")));
      expect(cover.join("\n")).toContain("action = settings.changed");
      expect(cover.join("\n")).toMatch(/Entries \d+/);
      // The other export waits for its own asker alone.
      expect((await as("viewer").get(`/exports/${res.body.document_id}`)).status).toBe(404);
    });

    test("the ledger cannot be edited", async () => {
      await expect(q("UPDATE audit_ledger SET action = 'x'")).rejects.toThrow();
      await expect(q("DELETE FROM audit_ledger")).rejects.toThrow();
    });
  });
});
