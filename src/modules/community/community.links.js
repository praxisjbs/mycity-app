"use strict";
/**
 * Link cards (docs/guides/community.md §3 step 18, §6): the first link of a text message
 * gets the page's card, fetched by the server once per address and kept for everyone.
 *
 *   cardFor(url, actor)          the composer: the card kept for the address, else fetched now
 *   linkFor(client, body, meta)  posting or editing a text: the card to attach at once, or the
 *                                address the link-preview job fetches after the commit
 *   attach(messageId, url)       the link-preview job: fetch (or reuse) the card and attach it
 *
 * A ready card is used for a week; a page that gave nothing, or could not be read, is asked
 * again after an hour. The page is never fetched inside a transaction: it is read first,
 * then kept in a short transaction of its own, and its picture copied into the vault in a
 * second one, so a picture the vault refuses costs the card its picture, never the card.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const links = require("../../services/web/links");
const pageCard = require("../../services/web/page-card");
const repo = require("./community.repo");
const { EVENTS } = require("./community.events");

const READY_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 60 * 60 * 1000;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * What a kept card is worth now: "ready" to use, "none" (nothing to show, asked within the
 * hour), or "stale" (never fetched, or due again).
 */
function stateOf(row, now = Date.now()) {
  if (!row) return "stale";
  const age = now - new Date(row.fetched_at).getTime();
  if (row.status === "ready") return age < READY_FOR_MS ? "ready" : "stale";
  return age < RETRY_AFTER_MS ? "none" : "stale";
}

/**
 * Copy a card's picture into the vault (type checked, metadata stripped, resized) and put it
 * on the card. A picture the vault refuses (not a photo, too large to decode) leaves the card
 * without one.
 */
async function keepPicture(previewId, image, actor) {
  try {
    const retired = await tx(async (client) => {
      const card = await repo.linkPreviewById(client, previewId, { lock: true });
      if (!card) return [];
      const doc = await vault.store(client, {
        file: { buffer: image.buffer, originalname: image.name },
        purpose: "attachment",
        doc_type: "link_preview_image",
        entity: { type: "community_link_preview", id: previewId },
        actor: actor || null,
      });
      await repo.setLinkPreviewImage(client, previewId, doc.document_id);
      // Two fetches of one address at once: the later picture wins and the earlier one goes.
      if (!card.image_document_id) return [];
      return (await vault.remove(client, card.image_document_id, { reason: "link card refreshed" })) || [];
    });
    await vault.removeFiles(retired);
  } catch (err) {
    logger.info({ err: err.message, community_link_preview_id: previewId }, "a link card's picture was refused");
  }
}

/**
 * Fetch a page's card and keep it, with its picture in the vault.
 * @param {string} url  in links.normalise() form
 * @param {object|string|null} actor  who asked: a person, or null for the system
 * @returns {Promise<object>} the kept community_link_preview row
 */
async function fetchAndKeep(url, actor) {
  const card = await pageCard.fetchCard(url);
  const ready = card.status === "ready";
  const { row, oldImage } = await tx(async (client) => {
    const before = await repo.linkPreviewByUrl(client, url, { lock: true });
    const kept = await repo.saveLinkPreview(client, {
      url,
      status: card.status,
      site_name: ready ? card.site_name : null,
      title: ready ? card.title : null,
      description: ready ? card.description : null,
    });
    await emit(client, {
      key: EVENTS.LINK_PREVIEW_FETCHED,
      entity: { type: "community_link_preview", id: kept.community_link_preview_id },
      actor: actor || null,
      after: kept,
      payload: { url, status: card.status, reason: card.reason || null },
    });
    return { row: kept, oldImage: before ? before.image_document_id : null };
  });
  if (oldImage) await retirePicture(oldImage);
  if (ready && card.image) {
    await keepPicture(row.community_link_preview_id, card.image, actor);
    return repo.linkPreviewByUrl(pool, url);
  }
  return row;
}

/** Remove a card's old picture from the vault, and its bytes once that has committed. */
async function retirePicture(documentId) {
  try {
    const keys = await tx((client) => vault.remove(client, documentId, { reason: "link card refreshed" }));
    await vault.removeFiles(keys);
  } catch (err) {
    logger.warn({ err: err.message, document_id: documentId }, "a link card's old picture was not removed");
  }
}

/**
 * The card for one address, for the composer: the kept one, else fetched now.
 * @returns {Promise<object|null>} the contract's LinkPreview, or null when there is none
 */
async function cardFor(raw, actor) {
  const url = links.normalise(raw);
  if (!url) return null;
  let row = await repo.linkPreviewByUrl(pool, url);
  if (stateOf(row) === "stale") row = await fetchAndKeep(url, actor);
  if (!row || row.status !== "ready") return null;
  return repo.linkPreviewView(pool, row.community_link_preview_id);
}

/**
 * The card a text gets as it is posted or edited: the kept one at once, or the address to
 * fetch after the commit. Nothing when the sender removed it or the text has no link.
 * @returns {Promise<{community_link_preview_id: string|null, fetch: string|null}>}
 */
async function linkFor(client, text, metadata = {}) {
  const none = { community_link_preview_id: null, fetch: null };
  if (metadata.no_link_preview) return none;
  const url = links.firstLink(text);
  if (!url) return none;
  const row = await repo.linkPreviewByUrl(client, url);
  const state = stateOf(row);
  if (state === "ready") return { community_link_preview_id: row.community_link_preview_id, fetch: null };
  if (state === "none") return none;
  return { community_link_preview_id: null, fetch: url };
}

/**
 * The link-preview job: give a message the card of its first link, once it has one.
 * @returns {Promise<object>} what was done, for the job's log
 */
async function attach(messageId, url) {
  const message = await repo.messageForCard(pool, messageId);
  if (!message || message.deleted_at || message.message_type !== "text")
    return { community_message_id: messageId, skipped: "gone" };
  if ((message.metadata || {}).no_link_preview || links.firstLink(message.body) !== url)
    return { community_message_id: messageId, skipped: "changed" };
  let row = await repo.linkPreviewByUrl(pool, url);
  if (stateOf(row) === "stale") row = await fetchAndKeep(url, message.sender_user_id);
  if (!row || row.status !== "ready")
    return { community_message_id: messageId, skipped: row ? row.status : "failed" };
  const attached = await tx(async (client) => {
    const after = await repo.attachLinkPreview(client, messageId, row.community_link_preview_id);
    if (!after) return false;
    await emit(client, {
      key: EVENTS.CHANNEL_MESSAGE_LINK_PREVIEWED,
      entity: { type: "channel_message", id: messageId },
      actor: null,
      payload: {
        community_channel_id: after.community_channel_id,
        community_message_id: messageId,
        community_link_preview_id: row.community_link_preview_id,
      },
    });
    return true;
  });
  return { community_message_id: messageId, attached };
}

module.exports = { READY_FOR_MS, RETRY_AFTER_MS, stateOf, cardFor, linkFor, attach, fetchAndKeep };
