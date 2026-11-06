"use strict";
/**
 * Partnership categories (docs/guides/partnerships.md §4.2, §6.3), read: the list the forms pick a
 * category from and the lists filter by, a page of 25 at a time (F32), and one category's defaults
 * for a new deal (its commission and validity). MyCity enters them on Categories or with Start From
 * Tracker; the writes, the templates, checklists and custom fields arrive with Categories (M7 PR 2).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const SORTS = { display_order: "c.display_order, c.name", name: "c.name" };

/**
 * A page of categories, each with how many partners and leads are in it.
 * @param {{query: Function}} db
 * @param {{page?: number, q?: string, active?: boolean, sort?: object}} query  CategoryListQuery
 */
function page(db, query) {
  const params = [query.active === undefined ? null : query.active, query.q || null];
  return pageQuery(
    db,
    `SELECT c.partner_category_id, c.name::text AS name, c.description, c.default_commission_pct::text AS default_commission_pct,
            c.default_validity_days, c.counts_as_vendor, c.display_order, c.active,
            (SELECT count(*)::int FROM partner p WHERE p.partner_category_id = c.partner_category_id) AS partners,
            (SELECT count(*)::int FROM lead l WHERE l.partner_category_id = c.partner_category_id AND l.status <> 'converted') AS leads,
            ${TOTAL_COL}
       FROM partner_category c
      WHERE ($1::boolean IS NULL OR c.active = $1)
        AND ($2::text IS NULL OR search_fold(c.name::text) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, SORTS, "c.partner_category_id")}`,
    params,
    query,
  );
}

/** One category's name and defaults, or null. */
async function one(db, id) {
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT partner_category_id, name::text AS name, default_commission_pct::text AS default_commission_pct,
            default_validity_days, active
       FROM partner_category WHERE partner_category_id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = { page, one };
