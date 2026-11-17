"use strict";
/**
 * Staging demonstration data: the Document Centre's categories and company documents (M10;
 * docs/guides/document-centre.md §6.4, §6.5, Appendix A PR 2; F13). Production gets none (A26):
 * MyCity names its own categories and uploads its own papers.
 *
 * Everything goes through the services, as the screens would, as Operations & People
 * (documents.manage), else the CEO:
 *
 *   categories   Registration & Statutory, Licences & Permits and Templates, seen by everyone; and
 *                Finance Records, seen by the Management and Operations & People roles only.
 *   documents    three papers of our own printed here through the PDF service, each with words in
 *                it a search inside files finds: a sample certificate of incorporation, a business
 *                premises permit expiring in 45 days (so Expiring Soon counts one, and its reminder
 *                comes), and a sample annual status report in Finance Records. Each is marked
 *                SAMPLE: none is a real record of the company.
 *
 * Run only by `scripts/db/seed.js --staging` (which refuses production three ways), after
 * 10_staff.js. Idempotent: a category is found by its name, a document by its title, and a second
 * run adds nothing. A part that fails is logged and the rest carry on.
 */
const path = require("node:path");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const { realStaff } = require("./lib/staff");

const ROOT = path.resolve(__dirname, "..", "..");
const src = (p) => require(path.join(ROOT, "src", p));

const CATEGORIES = Object.freeze([
  { name: "Registration & Statutory", description: "Incorporation, status reports and filings.", audience: "everyone" },
  { name: "Licences & Permits", description: "Operating licences and permits, with their expiry.", audience: "everyone" },
  { name: "Templates", description: "Blank forms and templates to download.", audience: "everyone" },
  { name: "Finance Records", description: "Audited accounts and tax filings.", audience: "roles", roles: ["management", "operations_people"] },
]);

const DOCUMENTS = Object.freeze([
  {
    title: "Certificate of Incorporation (Sample)",
    category: "Registration & Statutory",
    tags: ["cac", "incorporation"],
    body: "SAMPLE. Certificate of Incorporation of a private company limited by shares. Corporate Affairs Commission. This sample shows how a registration certificate is kept in the Document Centre.",
  },
  {
    title: "Business Premises Permit (Sample)",
    category: "Licences & Permits",
    tags: ["permit", "lagos"],
    expires_in_days: 45,
    body: "SAMPLE. Business premises registration permit for the Lagos office. Renew before it lapses. This sample shows how an expiring licence is reminded.",
  },
  {
    title: "Annual Status Report (Sample)",
    category: "Finance Records",
    tags: ["status report", "cac"],
    body: "SAMPLE. Annual status report filed with the Corporate Affairs Commission: share capital, directors and registered office. Seen only by Management and Operations & People.",
  },
]);

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

const escape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One page of our own, printed through the PDF service, so its text can be searched. */
async function printed(doc) {
  const pdf = src("services/pdf/pdf.service");
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;margin:40px;color:#09090B}h1{color:#014339}</style></head>
    <body><h1>${escape(doc.title)}</h1><p>${escape(doc.body)}</p></body></html>`;
  return pdf.render(page, { footer: "SAMPLE for staging" });
}

async function seed({ pool, log = () => {} }) {
  const staff = await realStaff(pool);
  const user = (await callerOf(pool, staff.operations)) || (await callerOf(pool, staff.ceo));
  if (!user) return log("documents: nobody with a login to file them as; skipped");
  const library = src("modules/library/library.service");
  const uploads = src("modules/documents/documents.service");
  const lagos = src("shared/time/lagos");

  const categories = new Map();
  for (const cat of CATEGORIES) {
    try {
      const found = await pool.query("SELECT document_category_id FROM document_category WHERE name = $1::citext", [cat.name]);
      if (found.rows[0]) {
        categories.set(cat.name, found.rows[0].document_category_id);
        continue;
      }
      const roles = cat.roles
        ? (await pool.query("SELECT role_id FROM role WHERE code = ANY($1::text[])", [cat.roles])).rows.map((r) => r.role_id)
        : [];
      const made = await library.createCategory({ name: cat.name, description: cat.description, audience: cat.audience, role_ids: roles }, user);
      categories.set(cat.name, made.document_category_id);
      log(`documents: category ${cat.name}`);
    } catch (err) {
      log(`documents: category ${cat.name} stopped: ${err.message}`);
    }
  }

  for (const doc of DOCUMENTS) {
    try {
      if ((await pool.query("SELECT 1 FROM company_document WHERE title = $1", [doc.title])).rows.length) continue;
      const category = categories.get(doc.category);
      if (!category) continue;
      const buffer = await printed(doc);
      const name = `${doc.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/-+$/, "")}.pdf`;
      const staged = await uploads.stage({ buffer, originalname: name, size: buffer.length, mimetype: "application/pdf" }, { purpose: "document" }, user);
      await library.create(
        {
          document_id: staged.document_id,
          title: doc.title,
          document_category_id: category,
          tags: doc.tags,
          expires_on: doc.expires_in_days ? lagos.addDays(lagos.today(), doc.expires_in_days) : null,
          description: null,
        },
        user,
      );
      log(`documents: ${doc.title}`);
    } catch (err) {
      log(`documents: ${doc.title} stopped: ${err.message}`);
    }
  }
}

module.exports = seed;
module.exports.CATEGORIES = CATEGORIES;
