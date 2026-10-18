"use strict";
/**
 * Home · Overview: the reader's Overview, the records behind a card, the cards a person
 * chooses for themselves and the cards a role opens on (docs/guides/home.md §2 to §6).
 *
 * Who the reader is decides everything here, and it is read the same way each time
 * (readerOf): their Home view, first name and effective roles from identity (the /me read,
 * so the screen and the server agree), the cards they may see and their scope on each
 * module from the KPI catalogue's eligibility, their own pick and their roles' cards.
 *
 *   overview()       GET /home/overview
 *   kpiMeta()        GET /home/kpi/:key/meta   a card the reader may not see is a 404
 *   kpiPage()        GET /home/kpi/:key        the controller masks the rows
 *   picker()         GET /home/kpi-picker
 *   savePicks()      PUT /home/kpi-picks       up to four cards they may see, locks kept
 *   resetPicks()     DELETE /home/kpi-picks    back to their roles' cards
 *   roleCards()      GET /home/roles/:role_id/kpis, offered from the cards the ROLE may see
 *   saveRoleCards()  PUT
 *   resetRoleCards() DELETE
 *   pruneRoleCards() the outbox handler after a role's access changes (dashboard.events.js)
 *   myCards()        the assistant's `cards.mine` read (dashboard.ai.js)
 *
 * Every write runs in one transaction with its event. Saving what is already saved writes
 * nothing and records nothing (home.md §11, Double submit).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");
const access = require("../access/access.service");
const identity = require("../identity/identity.service");
const kpi = require("./kpi-catalog");
const eligibility = require("./kpi-catalog/eligibility");
const resolve = require("./kpi-catalog/resolve");
const { openToClear } = require("./kpi-catalog/tiles/work");
const activity = require("./dashboard.activity");
const layout = require("./dashboard.layout");
const prompt = require("./dashboard.prompt");
const repo = require("./dashboard.repo");
const { EVENTS } = require("./dashboard.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "Not found", 404);

const sameList = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Everything the Overview, the picker and a card's records are resolved from.
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 */
async function readerOf(db, user) {
  const me = await identity.me(db, user.user_id);
  const [{ eligible, scopes }, pick, rolesCards] = await Promise.all([
    eligibility.forUser(db, user),
    repo.pickOf(db, user.user_id),
    repo.roleCardsByCodes(db, me.roles.map((role) => role.code)),
  ]);
  return { me, eligible, scopes, picks: pick ? pick.kpi_ids : null, roleCards: rolesCards };
}

/** The resolution's input for a reader (kpi-catalog/resolve.js). */
const choiceOf = (reader) => ({
  picks: reader.picks,
  roleCards: reader.roleCards,
  homeView: reader.me.home_view,
  eligible: reader.eligible,
});

/** The reader's cards, resolved and painted with their figures, in order. */
async function cardsOf(db, user, reader, { today, now }) {
  const selected = resolve.selectCards(choiceOf(reader));
  const ctx = kpi.context({ user, scopes: reader.scopes, today, now });
  const { cards } = resolve.paintCards(selected.ids, await kpi.figuresFor(db, selected.ids, ctx));
  return { source: selected.source, cards };
}

/** Open alerts the reader may clear, or null for a reader without `alerts.clear`. */
async function alertsToClear(db, user) {
  if (user.is_ceo !== true && !(await grantsCache.getCapabilities(db, user.user_id)).includes("alerts.clear"))
    return null;
  return openToClear(db, user);
}

/* ------------------------------------------------------------------ *
 * The Overview
 * ------------------------------------------------------------------ */

/**
 * GET /home/overview (HomeOverview). Each part is read on its own: a card, a section, the
 * activity or the alert count that cannot be read is logged and left out, never drawn as
 * a zero or an empty list (home.md §6), and the rest of the Overview still answers.
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean, session_id?: string}} user  req.user
 * @param {{now?: Date}} [at]  the moment it is read; now unless a test says otherwise
 */
async function overview(user, { now = new Date() } = {}) {
  const today = lagos.today(now);
  const reader = await readerOf(pool, user);
  const [cards, sections, happened, toClear, promptClockIn] = await Promise.all([
    cardsOf(pool, user, reader, { today, now }),
    layout.sectionsFor(pool, { user, view: reader.me.home_view, today, scopes: reader.scopes }),
    layout.guarded("activity", () => activity.today(pool, user, { today })),
    layout.guarded("alerts_to_clear", () => alertsToClear(pool, user)),
    layout.guarded("prompt_clock_in", () => prompt.shouldPrompt(pool, user, { now, today })),
  ]);
  return {
    greeting_name: reader.me.first_name,
    date: today,
    clocked_in: sections.clocked_in,
    cards: cards.cards,
    picker_source: cards.source,
    chart: sections.chart,
    donut: sections.donut,
    day_strip: sections.day_strip,
    pipeline: sections.pipeline,
    goals: sections.goals,
    my_goals: sections.my_goals,
    upcoming_leave: sections.upcoming_leave,
    activity: happened,
    week: sections.week,
    alerts_to_clear: toClear,
    // A prompt that could not be decided is not shown.
    prompt_clock_in: promptClockIn === true,
  };
}

/**
 * The assistant's `cards.mine`: the reader's cards with their figures, as the Overview
 * paints them, and where they came from.
 * @param {object} actor  req.user with the AI layer's scope
 */
async function myCards(actor, { now = new Date() } = {}) {
  return cardsOf(pool, actor, await readerOf(pool, actor), { today: lagos.today(now), now });
}

/* ------------------------------------------------------------------ *
 * The records behind a card
 * ------------------------------------------------------------------ */

/**
 * The card `key` and the reader's context for it, or a 404 when it is not a live card they
 * may see: an unknown key, a hidden card and a card whose module, capability or field they
 * lack all answer the same, so a person never learns what they cannot open.
 */
async function cardFor(user, key, now) {
  const entry = kpi.BY_ID.get(key);
  if (!entry || entry.status !== "live") throw notFound();
  const { eligible, scopes } = await eligibility.forUser(pool, user);
  if (!eligible.has(key)) throw notFound();
  return { entry, ctx: kpi.context({ user, scopes, today: lagos.today(now), now }) };
}

/** GET /home/kpi/:key/meta (HomeKpiDetailMeta): the title, the line above the list, its columns and chips. */
async function kpiMeta(user, key, { now = new Date() } = {}) {
  const { entry, ctx } = await cardFor(user, key, now);
  return kpi.metaOf(entry, await kpi.figureOf(entry, pool, ctx));
}

/** GET /home/kpi/:key (HomeKpiDetailPage): one page of the records behind the card, in the reader's scope. */
async function kpiPage(user, key, query, { now = new Date() } = {}) {
  const { entry, ctx } = await cardFor(user, key, now);
  return kpi.detailPage(entry, pool, query, ctx);
}

/* ------------------------------------------------------------------ *
 * The cards a person chooses
 * ------------------------------------------------------------------ */

/** GET /home/kpi-picker (HomeKpiPicker). */
async function picker(user) {
  return resolve.pickerModel(choiceOf(await readerOf(pool, user)));
}

/**
 * PUT /home/kpi-picks. Up to four cards (the contract), each one the person may choose,
 * every card their roles lock kept. The roles' own cards restated in their order are
 * saved as following the roles, so a later change to the role reaches them.
 * @param {object} actor  req.user with the caller's IP (withActor)
 * @param {{kpi_ids: string[]}} body  HomeKpiPicks
 */
async function savePicks(actor, body) {
  const reader = await readerOf(pool, actor);
  const ids = body.kpi_ids;
  if (ids.some((id) => !kpi.isPickable(id) || !reader.eligible.has(id)))
    throw new AppError("KPI_NOT_AVAILABLE", "Pick cards you can see", 422, { kpi_ids: ["Card not available"] });
  const model = resolve.pickerModel(choiceOf(reader));
  if (model.locked_ids.some((id) => !ids.includes(id)))
    throw new AppError("KPI_LOCKED", "Locked cards stay on your Home", 422, { kpi_ids: ["Locked cards stay"] });
  const followRoles = sameList(ids, model.default_ids);

  await tx(async (client) => {
    const before = await repo.pickOf(client, actor.user_id, { lock: true });
    if (followRoles) {
      if (before) await recordPick(client, actor, before, await repo.deletePick(client, actor.user_id), null);
      return;
    }
    if (before && sameList(before.kpi_ids, ids)) return;
    const after = await repo.savePick(client, actor.user_id, ids);
    await recordPick(client, actor, before, after, after.kpi_ids);
  });
  return picker(actor);
}

/** The audit line of a change to a person's pick; `kpiIds` null when they follow their roles again. */
function recordPick(client, actor, before, row, kpiIds) {
  return emit(client, {
    key: EVENTS.HOME_KPI_PICKS_CHANGED,
    entity: { type: "home_kpi_pick", id: row.home_kpi_pick_id },
    actor,
    before: before ? { kpi_ids: before.kpi_ids } : undefined,
    after: kpiIds ? { kpi_ids: kpiIds } : undefined,
    payload: { user_id: actor.user_id, kpi_ids: kpiIds },
  });
}

/** DELETE /home/kpi-picks: back to their roles' cards. Nothing to forget, nothing recorded. */
async function resetPicks(actor) {
  await tx(async (client) => {
    const before = await repo.pickOf(client, actor.user_id, { lock: true });
    if (!before) return;
    await recordPick(client, actor, before, await repo.deletePick(client, actor.user_id), null);
  });
}

/* ------------------------------------------------------------------ *
 * The cards a role opens on
 * ------------------------------------------------------------------ */

/** The cards a role may be given: live, offered in the picker, and ones the role may see. */
const offeredTo = (eligible) => kpi.CATALOG.filter((e) => kpi.isPickable(e.id) && eligible.has(e.id));

/**
 * GET /home/roles/:role_id/kpis (HomeRoleKpis). Offers the cards the ROLE may see, not the
 * editor's, and shows its saved cards as the role may see them. A role that does not exist
 * is a 404.
 * @param {string} roleId
 */
async function roleCards(roleId) {
  const role = await access.roleDetail(roleId);
  const [eligible, row] = await Promise.all([eligibility.forRole(pool, roleId), repo.roleCardsOf(pool, roleId)]);
  const defaults = row ? resolve.keepEligible(row.default_ids, eligible).slice(0, kpi.MAX_CARDS) : [];
  return {
    role_id: roleId,
    default_ids: defaults,
    locked_ids: row ? resolve.keepEligible(row.locked_ids, eligible).filter((id) => defaults.includes(id)) : [],
    configured: Boolean(row),
    view_default_ids: resolve.viewDefaults(role.home_view, eligible),
    cards: offeredTo(eligible).map(kpi.optionOf),
  };
}

/** The audit line of a change to a role's cards; `after` null when the role has none of its own again. */
function recordRoleCards(client, actor, roleId, before, after, payload = {}) {
  const held = (row) => (row ? { default_ids: row.default_ids, locked_ids: row.locked_ids } : undefined);
  return emit(client, {
    key: EVENTS.HOME_ROLE_KPIS_CHANGED,
    entity: { type: "role", id: roleId },
    actor,
    before: held(before),
    after: held(after),
    payload: { role_id: roleId, ...payload },
  });
}

/**
 * PUT /home/roles/:role_id/kpis. Up to four defaults in order and the locks among them (the
 * contract), each one a card the role may see. A save with no default takes the role back to
 * its Home view's cards, as DELETE and the prune do: a role row always holds a default, so
 * `configured` never says a role opens on cards its members do not get.
 * @param {string} roleId
 * @param {{default_ids: string[], locked_ids: string[]}} body  HomeRoleKpisSave
 * @param {object} actor  req.user with the caller's IP
 */
async function saveRoleCards(roleId, body, actor) {
  await access.roleDetail(roleId);
  await tx(async (client) => {
    const eligible = await eligibility.forRole(client, roleId);
    if (body.default_ids.some((id) => !kpi.isPickable(id) || !eligible.has(id)))
      throw new AppError("KPI_NOT_FOR_ROLE", "Pick cards this role can see", 422, {
        default_ids: ["Role cannot see it"],
      });
    if (!body.default_ids.length) {
      // The contract keeps the locks among the defaults, so there are none either.
      const removed = await repo.deleteRoleCards(client, roleId);
      if (removed) await recordRoleCards(client, actor, roleId, removed, null);
      return;
    }
    const before = await repo.roleCardsOf(client, roleId, { lock: true });
    if (before && sameList(before.default_ids, body.default_ids) && sameList(before.locked_ids, body.locked_ids))
      return;
    const after = await repo.saveRoleCards(client, roleId, {
      default_ids: body.default_ids,
      locked_ids: body.locked_ids,
      updated_by: actor.user_id || null,
    });
    await recordRoleCards(client, actor, roleId, before, after);
  });
  return roleCards(roleId);
}

/** DELETE /home/roles/:role_id/kpis: back to the Home view's defaults. */
async function resetRoleCards(roleId, actor) {
  await access.roleDetail(roleId);
  await tx(async (client) => {
    const before = await repo.deleteRoleCards(client, roleId);
    if (before) await recordRoleCards(client, actor, roleId, before, null);
  });
}

/**
 * After a role's grants, capabilities or masked fields change: take out of its cards the
 * ones it may no longer see, and the row itself when no card is left. Runs as the system,
 * after the access change commits, at least once: a second run finds nothing to take out
 * and records nothing.
 * @param {string} roleId
 */
async function pruneRoleCards(roleId) {
  if (!roleId) return;
  await tx(async (client) => {
    const before = await repo.roleCardsOf(client, roleId, { lock: true });
    if (!before) return;
    const eligible = await eligibility.forRole(client, roleId);
    const defaults = resolve.keepEligible(before.default_ids, eligible);
    const locked = resolve.keepEligible(before.locked_ids, eligible).filter((id) => defaults.includes(id));
    if (sameList(defaults, before.default_ids) && sameList(locked, before.locked_ids)) return;
    const after = defaults.length
      ? await repo.saveRoleCards(client, roleId, { default_ids: defaults, locked_ids: locked, updated_by: null })
      : null;
    if (!after) await repo.deleteRoleCards(client, roleId);
    await recordRoleCards(client, null, roleId, before, after, { pruned: true });
  });
}

module.exports = {
  overview,
  myCards,
  kpiMeta,
  kpiPage,
  picker,
  savePicks,
  resetPicks,
  roleCards,
  saveRoleCards,
  resetRoleCards,
  pruneRoleCards,
};
