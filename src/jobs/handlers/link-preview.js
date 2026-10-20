"use strict";
/**
 * Queue `link-preview`: a text message was posted (or edited) before its first link had a
 * card. Fetch the card, or reuse one another message fetched meanwhile, and attach it
 * (docs/guides/community.md §3 step 18; community.links.js). Queued by
 * community.events.js after the post commits.
 *
 * Idempotent: a message that was deleted, edited to another link, or already has its card
 * is left as it is. A page that cannot be read is remembered for an hour, so a retry is
 * cheap; the job is not retried by BullMQ for it.
 */
const { UnrecoverableError } = require("bullmq");
const links = require("../../modules/community/community.links");

module.exports = async function linkPreview(job) {
  const id = job.data && job.data.community_message_id;
  const url = job.data && job.data.url;
  if (!id || !url)
    throw new UnrecoverableError("link-preview: the job needs community_message_id and url");
  return links.attach(id, url);
};
