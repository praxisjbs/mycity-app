"use strict";
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../../../../../src/http/route");
const router = express.Router();
route(router, "get", "/", { response: c.common.EmptyBody }, (_req, res) => res.json({}));
module.exports = { basePath: "/broken", surface: "staff", router };
