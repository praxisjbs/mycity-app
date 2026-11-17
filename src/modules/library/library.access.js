"use strict";
/**
 * Who reads a company document (docs/guides/document-centre.md §6.4), written once for the vault
 * (`mayRead`, given to vault.defineAccess in library.events.js) and once as SQL for the library's
 * list (`reach`, `readable`, library.library.js). tests/integration/library-access.test.js holds the
 * two equal for every role.
 *
 *   the CEO, and a holder of documents.manage      every company document, archived ones too
 *   whoever uploaded it                            their own, while it is not archived
 *   anyone with the `documents` view grant          while it is not archived, when its category is seen
 *                                                   by everyone, or by a role the reader holds
 *
 * Nothing is cached: narrowing a category's audience hides its documents at the next read.
 */
const grantsCache = require("../../shared/rbac/grants-cache");

const MANAGE = "documents.manage";

const scopeFor = (...args) => require("../../middleware/rbac").scopeFor(...args);

/** Whether the reader keeps the library: the CEO, or a holder of documents.manage. */
async function manages(client, user) {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(client, user.user_id)).includes(MANAGE);
}

/**
 * What the reader reaches, once per request.
 * @returns {Promise<{all: boolean, view: boolean, user_id: string|null, role_ids: string[]}>}
 */
async function reach(client, user) {
  const all = await manages(client, user);
  return {
    all,
    view: all || Boolean(await scopeFor(user, "documents", "view")),
    user_id: (user && user.user_id) || null,
    role_ids: (user && user.role_ids) || [],
  };
}

/** The SQL condition over `d` (a company document's file), appending its parameters. */
function readable(r, params) {
  if (!r) return "FALSE";
  if (r.all) return "TRUE";
  if (!r.user_id) return "FALSE";
  const bind = (value, cast) => {
    params.push(value);
    return `$${params.length}::${cast}`;
  };
  const mine = `cd.created_by = ${bind(r.user_id, "uuid")}`;
  const seen = r.view
    ? ` OR dc.audience = 'everyone' OR EXISTS (SELECT 1 FROM document_category_role dcr
                 WHERE dcr.document_category_id = dc.document_category_id AND dcr.role_id = ANY(${bind(r.role_ids, "uuid[]")}))`
    : "";
  return `EXISTS (SELECT 1 FROM company_document cd
                    JOIN document_category dc ON dc.document_category_id = cd.document_category_id
                   WHERE cd.company_document_id = d.entity_id::uuid AND cd.archived_at IS NULL
                     AND (${mine}${seen}))`;
}

/** The facts the rule reads about one company document. */
async function factsOf(client, companyDocumentId) {
  const { rows } = await client.query(
    `SELECT cd.created_by, cd.archived_at, dc.audience,
            ARRAY(SELECT dcr.role_id FROM document_category_role dcr WHERE dcr.document_category_id = dc.document_category_id) AS role_ids
       FROM company_document cd
       JOIN document_category dc ON dc.document_category_id = cd.document_category_id
      WHERE cd.company_document_id = $1::uuid`,
    [companyDocumentId],
  );
  return rows[0] || null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The vault's rule for a document stored against a company document (any of its versions).
 * @param {{query: Function}} client
 * @param {object} user  req.user
 * @param {object} doc   the vault's row
 */
async function mayRead(client, user, doc) {
  if (!user || !user.user_id || !doc) return false;
  if (await manages(client, user)) return true;
  if (!UUID_RE.test(String(doc.entity_id))) return false;
  const facts = await factsOf(client, doc.entity_id);
  if (!facts || facts.archived_at) return false;
  if (facts.created_by && facts.created_by === user.user_id) return true;
  if (!(await scopeFor(user, "documents", "view"))) return false;
  if (facts.audience === "everyone") return true;
  const mine = new Set(user.role_ids || []);
  return (facts.role_ids || []).some((id) => mine.has(id));
}

module.exports = { MANAGE, manages, reach, readable, mayRead };
