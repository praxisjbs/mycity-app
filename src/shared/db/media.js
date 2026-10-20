"use strict";
/**
 * A stored file as a screen draws it in place (the contract's MediaRef), in SQL.
 *
 *   `SELECT ${mediaJson("doc")} AS document`, with document `doc` joined
 *
 * builds { document_id, file_name, size_bytes, mime_type, width, height, page_count,
 * duration_ms, waveform, variants } from document `doc`, or null when it joined nothing (a LEFT JOIN
 * that missed). `variants` lists the kinds of its derived files (document_variant), so a
 * screen asks only for a size that exists: `webp-960` and `webp-320` for a photo or a PDF's
 * first page, `poster` and `mp4-720` for a video, `opus` for a voice note (services/media).
 */
const ALIAS_RE = /^[a-z_][a-z0-9_]{0,30}$/;

function checkAlias(alias) {
  if (!ALIAS_RE.test(String(alias))) throw new Error(`media: "${alias}" is not a table alias`);
  return alias;
}

/** MediaRef as SQL, from document `doc`; null when `doc` joined nothing. */
const mediaJson = (doc = "doc") =>
  `CASE WHEN ${checkAlias(doc)}.document_id IS NULL THEN NULL ELSE json_build_object(
     'document_id', ${doc}.document_id,
     'file_name', COALESCE(${doc}.original_name, ${doc}.title, 'file'),
     'size_bytes', ${doc}.bytes,
     'mime_type', ${doc}.mime,
     'width', ${doc}.width,
     'height', ${doc}.height,
     'page_count', ${doc}.page_count,
     'duration_ms', ${doc}.duration_ms,
     'waveform', ${doc}.waveform,
     'variants', COALESCE((SELECT json_agg(v.kind ORDER BY v.kind) FROM document_variant v
                            WHERE v.document_id = ${doc}.document_id), '[]'::json)) END`;

module.exports = { mediaJson };
