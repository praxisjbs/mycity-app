"use strict";
/**
 * /api/v1/ai: Praxis AI · Ask and History (docs/guides/praxis-ai.md §5).
 *
 *   POST   /ask                      create  a question answered from the reads the caller may run
 *   GET    /suggestions              view    up to six questions the caller's reads can answer
 *   GET    /conversations            view    the caller's conversations, 25 a page
 *   GET    /conversations/:id/turns  view    one conversation's answers, newest page first
 *   DELETE /conversations/:id        view    delete one of the caller's conversations
 *   DELETE /history                  view    clear the caller's history
 *   GET    /history/summary          view    History's figures: the caller's own, or the company's with AI Control
 *   GET    /history/questions        view    the caller's questions, 25 a page, with sources, tokens and cost
 *   POST   /history/export           view    the caller's questions as a workbook (202, made in the worker)
 *   POST   /answers/:id/feedback     create  Helpful or Not Helpful
 *   GET    /answers/:id/reads/:n     view    read n of an answer run again, 25 a page (§6.12)
 *   GET    /cards/:id                view    a card the caller's answer drew (§6.11)
 *   PUT    /cards/:id                create  the caller's edits to its values
 *   POST   /cards/:id/confirm        create  the press: the action runs with the caller's rights
 *   POST   /cards/:id/cancel         create  the caller declines the card
 *   POST   /transcribe               create  a spoken question to words; the recording is not kept
 *
 * Every role holds `praxis_ai` (seed 0290); whatever its scope, History is the caller's own
 * (§1.1 decision 7), so deleting one's own words needs only `view`. A card's press checks the
 * action's own grant inside (authorise.checkAction).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const upload = require("../../middleware/upload");
const controller = require("./assistant.controller");

const router = express.Router();
const a = c.assistant;
const view = requirePermission("praxis_ai", "view");
const create = requirePermission("praxis_ai", "create");

route(router, "post", "/ask",
  { body: a.AiAsk, response: a.AiAnswer, summary: "Ask the assistant a question" },
  create, controller.ask);

route(router, "get", "/suggestions",
  { response: a.AiSuggestions, summary: "Questions the caller's reads can answer" },
  view, controller.suggestions);

route(router, "get", "/conversations",
  { query: a.AiConversationListQuery, response: a.AiConversationPage, summary: "My conversations with the assistant" },
  view, controller.conversations);

route(router, "get", "/conversations/:id/turns",
  { params: c.common.IdParams, query: a.AiTurnListQuery, response: a.AiTurnPage, summary: "One conversation's answers, newest first" },
  view, controller.turns);

route(router, "delete", "/conversations/:id",
  { params: c.common.IdParams, no_content: true, summary: "Delete one of my conversations" },
  view, controller.deleteConversation);

route(router, "delete", "/history",
  { no_content: true, summary: "Clear my history with the assistant" },
  view, controller.clearHistory);

route(router, "get", "/history/summary",
  { response: a.AiHistorySummary, summary: "History's figures: questions, spend and questions by module" },
  view, controller.summary);

route(router, "get", "/history/questions",
  { query: a.AiQuestionListQuery, response: a.AiQuestionPage, summary: "My questions to the assistant, with what each cost" },
  view, controller.questions);

route(router, "post", "/history/export",
  { body: c.common.EmptyBody, response: c.documents.ExportFile, summary: "Export my questions to the assistant as a workbook" },
  view, controller.exportHistory);

route(router, "post", "/answers/:id/feedback",
  { params: c.common.IdParams, body: a.AiFeedback, no_content: true, summary: "Mark an answer Helpful or Not Helpful" },
  create, controller.feedback);

route(router, "get", "/answers/:id/reads/:n",
  { params: a.AiReadParams, query: c.common.PageQuery, response: a.AiReadRows, summary: "One read of an answer, run again, 25 a page" },
  view, controller.readRows);

route(router, "get", "/cards/:id",
  { params: c.common.IdParams, response: a.AiActionCard, summary: "A card one of my answers drew" },
  view, controller.card);

route(router, "put", "/cards/:id",
  { params: c.common.IdParams, body: a.AiActionEdit, response: a.AiActionCard, summary: "Change a card's values" },
  create, controller.editCard);

route(router, "post", "/cards/:id/confirm",
  { params: c.common.IdParams, body: a.AiActionConfirm, response: a.AiActionResult, summary: "Press a card: the action runs with my rights" },
  create, controller.confirmCard);

route(router, "post", "/cards/:id/cancel",
  { params: c.common.IdParams, body: c.common.EmptyBody, response: a.AiActionCard, summary: "Decline a card" },
  create, controller.cancelCard);

route(router, "post", "/transcribe",
  { body: c.documents.DocumentUpload, response: a.AiTranscript, summary: "A spoken question to words" },
  create, upload.single("file", { purpose: "voice_note" }), controller.transcribe);

module.exports = { basePath: "/ai", surface: "staff", router };
