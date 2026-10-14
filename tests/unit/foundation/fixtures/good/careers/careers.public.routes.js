"use strict";
const express = require("express");
const c = require("@mycity/contract");
const { publicRoute } = require("../../../../../../src/http/route");
const router = express.Router();
publicRoute(router, "get", "/", { response: c.common.EmptyBody }, (_req, res) => res.json({}));
module.exports = { basePath: "/careers", surface: "public", router };
