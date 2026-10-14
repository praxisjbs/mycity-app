"use strict";
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../../../../../src/http/route");
const { requirePermission } = require("../../../../../../src/middleware/rbac");

const router = express.Router();

route(router, "get", "/", { query: c.common.PageQuery, response: c.common.PageMeta },
  requirePermission("people", "view"),
  (req, res) => res.json({ number: req.validated.query.page, size: 25, total: 0, pages: 0, has_next: false }));

route(router, "post", "/", { body: c.organisation.EmployeeCreate, response: c.common.EmptyBody },
  requirePermission("people", "create"),
  (_req, res) => res.status(201).json({}));

route(router, "get", "/:id", { response: c.common.EmptyBody },
  requirePermission("people", "view"),
  (req, res) => {
    res.set("x-id", req.validated.params.id);
    res.json(req.query.bad ? { unexpected: true } : {});
  });

route(router, "get", "/me/scope", { response: c.common.EmptyBody, self: true },
  (req, res) => { res.set("x-user", req.user.user_id); res.json({}); });

module.exports = { basePath: "/things", surface: "staff", router };
