"use strict";
/**
 * /api/v1/ai-control: AI Control (docs/guides/ai-control.md §5).
 *
 *   GET    /jobs                          view   the seven jobs, each with its chain
 *   GET    /actions                       view   the registered actions, 25 a page
 *   PUT    /chains/:scope/:key            edit   Edit Chain: a whole chain
 *   POST   /chains/:scope/:key/first      edit   Make First
 *   DELETE /chains/action/:key            edit   Use Job Chain
 *   GET    /models                        view   every provider's models, 25 a page
 *   GET    /models/summary                view   Find Prices' state, the open proposals, the rate
 *   PUT    /models/:id/prices             edit   Edit Price
 *   POST   /prices/find                   edit   Find Prices (202: the worker searches)
 *   GET    /prices                        view   the open proposals, 25 a page
 *   POST   /prices/accept-all             edit   Accept All: every open proposal, as proposed
 *   POST   /prices/:id/accept             edit   Accept, edited or not
 *   POST   /prices/:id/dismiss            edit   Dismiss
 *   GET    /spend                         view   this Lagos month against the caps
 *   GET    /spend/actions                 view   this month by action, 25 a page
 *   PUT    /caps/:provider                edit   a paid provider's monthly cap
 *   PUT    /cap                           edit   the cap on all AI
 *
 * The `ai_control` key (seed 10290): the Implementation Team and the System Administrator edit,
 * Operations & People view, nobody else holds it.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./ai_governance.controller");

const router = express.Router();
const a = c.ai_control;
const view = requirePermission("ai_control", "view");
const edit = requirePermission("ai_control", "edit");

route(router, "get", "/jobs",
  { query: c.common.PageQuery, response: a.AiJobPage, summary: "The seven AI jobs and their chains" },
  view, controller.jobs);

route(router, "get", "/actions",
  { query: a.AiActionListQuery, response: a.AiActionPage, summary: "The registered AI actions and their chains" },
  view, controller.actions);

route(router, "put", "/chains/:scope/:key",
  { params: a.AiChainParams, body: a.AiChainSave, response: a.AiChain, summary: "Save a job's or an action's chain" },
  edit, controller.saveChain);

route(router, "post", "/chains/:scope/:key/first",
  { params: a.AiChainParams, body: a.AiMakeFirst, response: a.AiChain, summary: "Move a model to the front of its chain" },
  edit, controller.makeFirst);

route(router, "delete", "/chains/action/:key",
  { params: a.AiActionParams, no_content: true, summary: "Put an action back on its job's chain" },
  edit, controller.resetChain);

route(router, "get", "/models/summary",
  { response: a.AiModelsSummary, summary: "Find Prices' state, the open proposals and the day's rate" },
  view, controller.modelsSummary);

route(router, "get", "/models",
  { query: a.AiControlModelListQuery, response: a.AiControlModelPage, summary: "Every AI provider's models with their prices" },
  view, controller.models);

route(router, "put", "/models/:id/prices",
  { params: a.AiIdParams, body: a.AiPricesSave, response: a.AiControlModel, summary: "Set a model's prices by hand" },
  edit, controller.setPrices);

route(router, "post", "/prices/find",
  { body: c.common.EmptyBody, response: a.AiFindPrices, summary: "Find the providers' prices" },
  edit, controller.findPrices);

route(router, "get", "/prices",
  { query: c.common.PageQuery, response: a.AiPriceProposalPage, summary: "The prices Find Prices proposed" },
  view, controller.proposals);

route(router, "post", "/prices/accept-all",
  { body: c.common.EmptyBody, response: a.AiAcceptAll, summary: "Accept every proposed price" },
  edit, controller.acceptAll);

route(router, "post", "/prices/:id/accept",
  { params: a.AiIdParams, body: a.AiPricesSave, response: a.AiControlModel, summary: "Accept a proposed price" },
  edit, controller.acceptProposal);

route(router, "post", "/prices/:id/dismiss",
  { params: a.AiIdParams, body: c.common.EmptyBody, no_content: true, summary: "Dismiss a proposed price" },
  edit, controller.dismissProposal);

route(router, "get", "/spend",
  { response: a.AiSpend, summary: "This month's AI spend against the caps" },
  view, controller.spend);

route(router, "get", "/spend/actions",
  { query: c.common.PageQuery, response: a.AiSpendActionPage, summary: "This month's AI spend by action" },
  view, controller.spendActions);

route(router, "put", "/caps/:provider",
  { params: a.AiCapParams, body: a.AiCapSave, response: a.AiSpend, summary: "Set a paid provider's monthly cap" },
  edit, controller.setCap);

route(router, "put", "/cap",
  { body: a.AiCapSave, response: a.AiSpend, summary: "Set the monthly cap on all AI" },
  edit, controller.setOverallCap);

module.exports = { basePath: "/ai-control", surface: "staff", router };
