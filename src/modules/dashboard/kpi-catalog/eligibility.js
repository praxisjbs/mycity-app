"use strict";
/**
 * Which cards a subject may see: one person reading Home, or one role whose cards are being
 * set. Two reads of the access rows and one rule, so the role editor offers exactly the
 * cards the role's members will be shown.
 *
 * A card is eligible when it is live, and the subject
 *   - holds `view` on the card's module (a person: through the same check a route makes,
 *     rbac.scopeFor, which also gives their scope on it; a role: its own permission row),
 *   - holds the card's capability, when it names one, and
 *   - does not have the card's sensitive field masked.
 *
 * Masking follows the access layer's rule for a person: a field is masked only when every
 * role of theirs that says anything about it masks it, so one role that shows it shows it
 * (grants-cache getMaskedFieldKeys). A role being edited masks a field when its own row does.
 *
 * The CEO (`is_ceo`) sees every live card: every grant, every capability, nothing masked,
 * as the access layer treats them everywhere else. A role is never the CEO.
 *
 * Eligibility is read every time it is asked, never stored: a role that loses a grant loses
 * its cards in the same moment the grant cache does.
 */
const rbac = require("../../../middleware/rbac");
const grantsCache = require("../../../shared/rbac/grants-cache");
const fieldMask = require("../../../shared/rbac/field-mask");
const { CATALOG, MODULES } = require("./index");

/**
 * The live card ids a subject may see.
 * @param {{viewable: Set<string>, capabilities: Set<string>, masked: Set<string>, ceo?: boolean}} subject
 * @returns {Set<string>}
 */
function eligibleIds({ viewable, capabilities, masked, ceo = false }) {
  return new Set(
    CATALOG.filter(
      (e) =>
        e.status === "live" &&
        (ceo ||
          (viewable.has(e.module) &&
            (!e.capability || capabilities.has(e.capability)) &&
            !(e.sensitive_field && masked.has(e.sensitive_field)))),
    ).map((e) => e.id),
  );
}

/**
 * A person: the cards they may see, and their scope on each module they may view (which
 * the cards' reads count within: index.context).
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 * @returns {Promise<{eligible: Set<string>, scopes: Map<string, object>}>}
 */
async function forUser(client, user) {
  const found = await Promise.all(MODULES.map((module) => rbac.scopeFor(user, module, "view")));
  const scopes = new Map(MODULES.map((module, i) => [module, found[i]]).filter(([, scope]) => scope));
  const ceo = user.is_ceo === true;
  // One after the other: `client` may be a transaction's, which runs one query at a time.
  const capabilities = ceo ? [] : await grantsCache.getCapabilities(client, user.user_id);
  const masked = ceo ? [] : await fieldMask.maskedKeysFor(client, user);
  const eligible = eligibleIds({
    viewable: new Set(scopes.keys()),
    capabilities: new Set(capabilities),
    masked: new Set(masked),
    ceo,
  });
  return { eligible, scopes };
}

/**
 * A role: the cards it may see, from its own rows (permission, role_capability,
 * field_visibility). An unknown role has none.
 * @param {{query: Function}} client
 * @param {string} roleId
 * @returns {Promise<Set<string>>}
 */
async function forRole(client, roleId) {
  // One after the other: the prune reads these inside its transaction, one query at a time.
  const views = await client.query("SELECT p.module_key FROM permission p WHERE p.role_id = $1 AND p.can_view", [
    roleId,
  ]);
  const caps = await client.query(
    `SELECT c.code::text AS code
       FROM role_capability rc
       JOIN capability c ON c.capability_id = rc.capability_id
      WHERE rc.role_id = $1`,
    [roleId],
  );
  const masks = await client.query(
    "SELECT fv.field_key FROM field_visibility fv WHERE fv.role_id = $1 AND fv.visibility = 'masked'",
    [roleId],
  );
  return eligibleIds({
    viewable: new Set(views.rows.map((r) => r.module_key)),
    capabilities: new Set(caps.rows.map((r) => r.code)),
    masked: new Set(masks.rows.map((r) => r.field_key)),
  });
}

module.exports = { eligibleIds, forUser, forRole };
