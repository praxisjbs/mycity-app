"use strict";
/**
 * Every email the code can send has a template that renders. A declared email whose
 * template file is missing or empty fails in the worker, after the request has already
 * answered that the email is on its way, so the person waits for mail that never comes.
 */
const fs = require("node:fs");
const path = require("node:path");
const variables = require("../../../src/shared/templates/variables");
const store = require("../../../src/shared/templates/template-store");
const mail = require("../../../src/services/mail/system-mail.service");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const nonEmpty = (f) => fs.existsSync(f) && fs.statSync(f).size > 0;

// Load everything that declares template variables: each module's events file and the job handlers.
for (const dir of fs.readdirSync(path.join(ROOT, "src", "modules"))) {
  const f = path.join(ROOT, "src", "modules", dir, `${dir}.events.js`);
  if (nonEmpty(f)) require(f);
}
for (const name of fs.readdirSync(path.join(ROOT, "src", "jobs", "handlers"))) {
  const f = path.join(ROOT, "src", "jobs", "handlers", name);
  if (name.endsWith(".js") && !name.endsWith(".test.js") && nonEmpty(f)) require(f);
}

const KEYS = variables.declaredKeys("email");
/** No stored edits: render the shipped template, as a fresh database does. */
const db = { query: async () => ({ rows: [] }) };
const org = { name: "MyCity App Ltd" };
const recipient = { first_name: "Ada", last_name: "Obi", email: "ada@mycity.test" };

test("the sign-in and notification emails are declared", () => {
  expect(KEYS).toEqual(expect.arrayContaining(["notification", "password-reset", "user-invite"]));
});

test.each(KEYS)("email %s has a template that names only declared variables", (key) => {
  const t = store.shipped("email", key);
  expect(t).not.toBeNull();
  expect(() => variables.assertTemplate("email", key, `${t.subject || ""}\n${t.body}`)).not.toThrow();
});

test("the reset email carries the link, how long it lasts, and the person's name", async () => {
  const link = "https://hub.mycityapp.io/reset?token=abc";
  const out = await mail.renderEmail(db, "password-reset", { link_url: link, minutes: 30 }, { recipient, org });
  expect(out.subject).toBe("Reset your MyCity App password");
  expect(out.html).toContain(`href="${link}"`);
  expect(out.text).toContain("Hello Ada,");
  expect(out.text).toContain("expires in 30 minutes");
});

test("the invitation names who invited them, the job, the sign-in email and the deadline", async () => {
  const link = "https://hub.mycityapp.io/welcome?token=abc";
  const out = await mail.renderEmail(
    db,
    "user-invite",
    { link_url: link, hours: 72, job_title: "Operations Lead", invited_by: "Tolu Adebayo" },
    { recipient, org },
  );
  expect(out.subject).toBe("Your MyCity App account is ready");
  expect(out.html).toContain(`href="${link}"`);
  expect(out.text).toContain("Tolu Adebayo has set up your MyCity App account as Operations Lead.");
  expect(out.text).toContain("You sign in with ada@mycity.test.");
  expect(out.text).toContain("expires in 72 hours");
});
