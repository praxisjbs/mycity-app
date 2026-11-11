"use strict";
/**
 * Staging demonstration data: the Knowledge Hub's SOPs and Training (M10; docs/guides/knowledge.md
 * §6.2 to §6.8, Appendix A PR 6; F13).
 *
 * Everything goes through the knowledge and training services, as the screens would:
 *
 *   SOPs       two for each of MyCity's five departments (knowledge/sops.js), each started, written
 *              and published by the department's head when they have a login, else by Operations &
 *              People (`sops.manage`), else the CEO. Steps that name a screen link it, so the
 *              procedure shows under Procedures on that screen's User Guide section. Leave Request
 *              Handling is published twice, so Versions has a history. Published quietly: nobody is
 *              told, because staging sends real mail and MyCity's staff are never the audience of
 *              demonstration data (TB, 27/10/2026); everyone can still read them on the SOPs tab.
 *   Training   two real courses (knowledge/courses.js), built by Operations & People: NDPA Data
 *              Protection Essentials and Partner Outreach, each of real YouTube videos played through
 *              youtube-nocookie.com, lessons in our own words, a PDF of our own printed here through
 *              the PDF service with the company's logo (knowledge/*.html), and a free outside course
 *              or the Act's official text as a link. Both in the Library, published with the
 *              publisher's drawn signature; NDPA assigned to the Implementation department, due in
 *              14 days, so its task and notice reach the Implementation Team's own accounts only.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js. Idempotent: an SOP is found by its department and title, a course by its title, and
 * a second run adds nothing. A part that fails is logged and the rest carry on, so a demonstration
 * gap never stops a deploy; a PDF that cannot be printed leaves its item out.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { realStaff } = require("./lib/staff");
const { signatureOf } = require("./lib/signature");
const { SOPS } = require("./knowledge/sops");
const { COURSES } = require("./knowledge/courses");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

/** The department a course is assigned to: our own team's, never MyCity's (see above). */
const AUDIENCE = "Implementation";

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

const nameOf = (p) => `${p.first_name} ${p.last_name}`;

/* ------------------------------------------------------------------ *
 * SOPs
 * ------------------------------------------------------------------ */

/** Each active department by name, with the employee who heads it now (by the post or its filled seat). */
async function departments(db) {
  const { rows } = await db.query(
    `SELECT d.department_id, d.name, COALESCE(d.head_employee_id, CASE WHEN s.status = 'filled' THEN s.filled_by_employee_id END) AS head_id
       FROM department d
       LEFT JOIN org_seat s ON s.org_seat_id = d.head_seat_id
      WHERE d.active`,
  );
  return new Map(rows.map((r) => [r.name, r]));
}

/** Who writes a department's SOPs here: its head with a login, else Operations & People, else the CEO. */
async function writerFor(db, staff, dept) {
  const head = dept.head_id ? staff.everyone.find((p) => p.employee_id === dept.head_id) : null;
  for (const person of [head, staff.operations, staff.ceo]) {
    const user = await callerOf(db, person);
    if (user) return user;
  }
  return null;
}

const stepsOf = (steps) =>
  steps.map((s) => ({ text: s.text, ...(s.who ? { who: s.who } : {}), ...(s.screen ? { screen_key: s.screen } : {}) }));

const draftOf = (plan, steps) =>
  c.knowledge.SopDraftSave.parse({ title: plan.title, purpose: plan.purpose, scope: plan.scope, roles: plan.roles, steps: stepsOf(steps) });

async function seedSops(pool, staff, log) {
  const sops = src("modules/knowledge/knowledge.service");
  const depts = await departments(pool);
  let made = 0;
  for (const plan of SOPS) {
    const dept = depts.get(plan.department);
    if (!dept) {
      log(`sops: no ${plan.department} department, ${plan.title} left out`);
      continue;
    }
    const { rows: had } = await pool.query("SELECT sop_id FROM sop WHERE department_id = $1 AND title = $2", [dept.department_id, plan.title]);
    if (had.length) continue;
    const by = await writerFor(pool, staff, dept);
    if (!by) {
      log(`sops: nobody to write ${plan.title}, left out`);
      continue;
    }
    try {
      const sop = await sops.create(by, c.knowledge.SopCreate.parse({ department_id: dept.department_id, title: plan.title }));
      await sops.saveDraft(by, sop.sop_id, draftOf(plan, plan.steps));
      await sops.publish(by, sop.sop_id, c.knowledge.SopPublish.parse({}), { quiet: true });
      if (plan.next) {
        const [at, text] = plan.next.change;
        const steps = plan.steps.map((s, i) => (i === at ? { ...s, text } : s));
        await sops.saveDraft(by, sop.sop_id, draftOf(plan, steps));
        await sops.publish(by, sop.sop_id, c.knowledge.SopPublish.parse({ note: plan.next.note }), { quiet: true });
      }
      made += 1;
    } catch (err) {
      log(`sops: ${plan.title} stopped: ${err.message}`);
    }
  }
  log(`sops: ${made} published across ${new Set(SOPS.map((s) => s.department)).size} departments, nobody told`);
}

/* ------------------------------------------------------------------ *
 * Training
 * ------------------------------------------------------------------ */

/** The face the PDFs set their words in: the proposal kit's Geist, one copy in the repository. */
function geist() {
  const dir = path.join(ROOT, "templates", "proposals", "fonts");
  const face = (file, range) =>
    `@font-face { font-family: "Geist"; font-style: normal; font-weight: 100 900; src: url(data:font/woff2;base64,${fs
      .readFileSync(path.join(dir, file))
      .toString("base64")}) format("woff2"); unicode-range: ${range}; }`;
  return [
    face("geist-latin.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD"),
    face("geist-latin-ext.woff2", "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF"),
  ].join("\n");
}

/**
 * One of this folder's pages printed to a PDF, as an upload would arrive, with the logo every PDF
 * carries: Settings · Organisation's, else assets/brand/logo.png (shared/documents/generate.js).
 */
async function printed(pool, name) {
  const pdf = src("services/pdf/pdf.service");
  const { orgProfile } = src("shared/documents/generate");
  const { logo } = await orgProfile(pool);
  const page = fs
    .readFileSync(path.join(__dirname, "knowledge", `${name}.html`), "utf8")
    .replace("{{FONTS}}", geist())
    .replace("{{LOGO}}", logo || "");
  const buffer = await pdf.render(page, { footer: "MyCity Learning & Development" });
  return { buffer, size: buffer.length, originalname: `${name}.pdf`, declared_type: "application/pdf", purpose: "attachment" };
}

/** Who builds the courses: Operations & People with `training.manage`, else one of our own team's accounts that holds it. */
async function builderOf(pool, staff) {
  const training = src("modules/training/training.service");
  const team = staff.everyone.filter((p) => p.department === AUDIENCE);
  for (const person of [staff.operations, ...team]) {
    const user = await callerOf(pool, person);
    if (user && (await training.canManage(pool, user))) return { user, person };
  }
  return null;
}

async function itemOf(pool, plan, by, log) {
  if (plan.kind !== "file") {
    const { pdf: _pdf, ...item } = plan;
    return c.training.ItemCreate.parse(item);
  }
  const documents = src("modules/documents/documents.service");
  try {
    const staged = await documents.stage(await printed(pool, plan.pdf), { purpose: "attachment" }, by);
    return c.training.ItemCreate.parse({ kind: "file", title: plan.title, document_id: staged.document_id, minutes: plan.minutes });
  } catch (err) {
    log(`training: ${plan.title} not printed, left out: ${err.message}`);
    return null;
  }
}

async function seedCourses(pool, staff, log) {
  const training = src("modules/training/training.service");
  const builder = await builderOf(pool, staff);
  if (!builder) {
    log("training: nobody holds training.manage with a login, no courses added");
    return;
  }
  const { user: by, person } = builder;
  const { rows: dept } = await pool.query("SELECT department_id FROM department WHERE name = $1 AND active", [AUDIENCE]);
  for (const plan of COURSES) {
    const { rows: had } = await pool.query("SELECT training_course_id FROM training_course WHERE title = $1", [plan.title]);
    if (had.length) continue;
    try {
      const course = await training.create(by, c.training.CourseCreate.parse({ title: plan.title, summary: plan.summary }));
      const id = course.training_course_id;
      for (const p of plan.items) {
        const item = await itemOf(pool, p, by, log);
        if (item) await training.addItem(by, id, item);
      }
      await training.update(
        by,
        id,
        c.training.CourseUpdate.parse({ library: plan.library, proof_required: plan.proof_required, ...(plan.proof_prompt ? { proof_prompt: plan.proof_prompt } : {}) }),
      );
      await training.publish(by, id, c.training.CoursePublish.parse({ signature: signatureOf(nameOf(person)) }));
      let to = "the Library";
      if (plan.assign && dept.length) {
        await training.assign(
          by,
          id,
          c.training.AssignmentCreate.parse({ everyone: false, department_ids: [dept[0].department_id], due_within_days: plan.assign.due_within_days, keep_assigning: true }),
        );
        to = `the Library and ${AUDIENCE}, due in ${plan.assign.due_within_days} days`;
      }
      log(`training: ${plan.title} published with ${plan.items.length} items, for ${to}`);
    } catch (err) {
      log(`training: ${plan.title} stopped: ${err.message}`);
    }
  }
}

async function seed({ pool, log = () => {} }) {
  const staff = await realStaff(pool);
  await seedSops(pool, staff, log);
  await seedCourses(pool, staff, log);
}

module.exports = seed;
module.exports.AUDIENCE = AUDIENCE;
