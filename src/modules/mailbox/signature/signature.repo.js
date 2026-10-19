"use strict";
/**
 * Signature SQL (mailbox.md §4): a person's numbers and switches (`mail_signature`), the company's
 * links and switches (`mail_signature_config`, one row at most) and what a signature is built
 * from. Every read is the caller's own: nothing here takes another person's id from a request.
 */

const MINE_COLUMNS = "mail_signature_id, office_line, show_mobile, show_whatsapp, updated_at";
const CONFIG_COLUMNS = `mail_signature_config_id, app_store_url, google_play_url, instagram_url, tiktok_url, linkedin_url, x_url,
  facebook_url, youtube_url, confidentiality_note, show_whatsapp, show_app_links, show_social_links,
  show_legal, updated_at`;

/** The person a login belongs to, with what a signature prints of them. */
async function personOf(db, userId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.first_name, e.last_name, e.preferred_name, e.job_title,
            d.name AS department, e.phone, e.work_email::text AS work_email
       FROM app_user u
       JOIN employee e ON e.employee_id = u.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE u.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

/** The address the person sends from: their connected mailbox, if they have one. */
async function mailboxOf(db, userId) {
  const { rows } = await db.query(
    "SELECT email::text AS email FROM mail_account WHERE user_id = $1 AND status <> 'disconnected'",
    [userId],
  );
  return rows[0] ? rows[0].email : null;
}

async function mineOf(db, userId) {
  const { rows } = await db.query(`SELECT ${MINE_COLUMNS} FROM mail_signature WHERE user_id = $1`, [userId]);
  return rows[0] || null;
}

/**
 * Write only what was given; a person with no row gets one, the rest at their defaults.
 * @param {{office_line?: string|null, show_mobile?: boolean, show_whatsapp?: boolean}} patch
 */
async function saveMine(db, userId, patch) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
  const { rows } = await db.query(
    `INSERT INTO mail_signature (user_id, office_line, show_mobile, show_whatsapp)
     VALUES ($1, $2, COALESCE($3, true), COALESCE($4, true))
     ON CONFLICT (user_id) DO UPDATE SET
       office_line = CASE WHEN $5 THEN EXCLUDED.office_line ELSE mail_signature.office_line END,
       show_mobile = COALESCE($3, mail_signature.show_mobile),
       show_whatsapp = COALESCE($4, mail_signature.show_whatsapp)
     RETURNING ${MINE_COLUMNS}`,
    [
      userId,
      has("office_line") ? patch.office_line : null,
      has("show_mobile") ? patch.show_mobile : null,
      has("show_whatsapp") ? patch.show_whatsapp : null,
      has("office_line"),
    ],
  );
  return rows[0];
}

/** The company's configuration, or null before anyone has saved one. */
async function configOf(db) {
  const { rows } = await db.query(`SELECT ${CONFIG_COLUMNS} FROM mail_signature_config`);
  return rows[0] || null;
}

const LINK_COLUMNS = [
  "app_store_url",
  "google_play_url",
  "instagram_url",
  "tiktok_url",
  "linkedin_url",
  "x_url",
  "facebook_url",
  "youtube_url",
  "confidentiality_note",
  "show_whatsapp",
  "show_app_links",
  "show_social_links",
  "show_legal",
];

/** Replace the configuration (the wizard saves all of it at once); the one row is made on first save. */
async function saveConfig(db, cfg, userId) {
  const values = LINK_COLUMNS.map((k) => cfg[k]);
  const params = LINK_COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  const sets = LINK_COLUMNS.map((k) => `${k} = EXCLUDED.${k}`).join(", ");
  const { rows } = await db.query(
    `INSERT INTO mail_signature_config (${LINK_COLUMNS.join(", ")}, updated_by)
     VALUES (${params}, $${LINK_COLUMNS.length + 1})
     ON CONFLICT ((true)) DO UPDATE SET ${sets}, updated_by = EXCLUDED.updated_by
     RETURNING ${CONFIG_COLUMNS}`,
    [...values, userId],
  );
  return rows[0];
}

/** The vault document already holding a signature picture with these bytes, if any. */
async function storedImage(db, hash) {
  const { rows } = await db.query(
    `SELECT document_id FROM document
      WHERE doc_type = 'mail_signature_image' AND entity_type = 'mail_signature_image' AND entity_id = $1
      ORDER BY created_at
      LIMIT 1`,
    [hash],
  );
  return rows[0] ? rows[0].document_id : null;
}

module.exports = { personOf, mailboxOf, mineOf, saveMine, configOf, saveConfig, storedImage, LINK_COLUMNS };
