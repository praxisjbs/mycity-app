"use strict";
/**
 * A bell row as the fan-out writes it, about one of a suite's own records: what a screen's views
 * count (`GET /notifications/views`, docs/guides/notifications.md §6, Where it waits), so a suite
 * proves its module places its records where its screen's filters find them.
 */
async function noticeAbout(db, userId, { entity_type: type, entity_id: id, read = false }) {
  const ev = await db.query(
    `INSERT INTO event_log (event_key, module_key, entity_type, entity_id, payload)
     VALUES ('test.happened', 'settings', $1, $2, '{}') RETURNING event_id`,
    [type, String(id)],
  );
  const { rows } = await db.query(
    `INSERT INTO notification (user_id, event_id, event_key, category, title, body, entity_type, entity_id, channels, read_at)
     VALUES ($1, $2, 'test.happened', 'system', 'Something happened', 'What happened.', $3, $4, ARRAY['in_app'], CASE WHEN $5 THEN now() END)
     RETURNING notification_id`,
    [userId, ev.rows[0].event_id, type, String(id), read],
  );
  return rows[0];
}

/** Every bell row of this person read, so a test counts only what it writes. */
const readAll = (db, userId) => db.query("UPDATE notification SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);

module.exports = { noticeAbout, readAll };
