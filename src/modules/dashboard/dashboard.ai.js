"use strict";
/**
 * What the assistant may read on Home's Overview, and where it sends a person to change
 * their cards (docs/guides/home.md §9; A23: it reads, it never writes).
 *
 *   cards.mine   the asker's own cards and their figures, resolved and counted exactly as
 *                their Overview paints them: the cards they may see, each in their scope
 *
 * Every login holds `home` view, which is all the assistant checks, so nothing here reads
 * past the asker's own cards: who may see each card is decided inside the read, as it is
 * on the screen. Choosing cards is the person's own act on the Overview; the assistant
 * routes them there, and to a card's records with `kpi`, the card's key.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const service = require("./dashboard.service");

module.exports = defineManifest({
  module: "home",
  reads: [
    {
      key: "cards.mine",
      description: "Read the cards on my own Home and their figures today, in the order my Overview shows them",
      params: c.common.EmptyBody,
      permission: ["home", "view"],
      run: (_client, _params, actor) => service.myCards(actor),
      cite: () => ({ type: "screen", id: "home.overview", label: "Home" }),
    },
  ],
  routes: [
    { intent: "choose the cards on my Home", screen: "home.overview" },
    { intent: "see who has clocked in today, by status", screen: "home.overview", params: { kpi: "attendance_today" } },
    { intent: "see the requests waiting on my approval", screen: "home.overview", params: { kpi: "approvals_awaiting_you" } },
  ],
});
