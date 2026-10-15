"use strict";
/**
 * Make Express 4 send async rejections to the error handler.
 *
 * Express 4 does not await a handler. An `async` handler that throws produces an
 * unhandled rejection: the error handler never runs, the client hangs, and under
 * Node's default policy the process exits. Every auth and permission check in
 * this codebase throws, so without this one anonymous request could stop the API.
 *
 * A dependency-free version of `express-async-errors` that patches the router
 * Layer once. Required at the top of app.js, before any router is built;
 * requiring it again is a no-op.
 */
const Layer = require("express/lib/router/layer");

if (!Layer.prototype.__mycityAsyncSafe) {
  const original = Layer.prototype.handle_request;
  Layer.prototype.handle_request = function handleRequest(req, res, next) {
    const fn = this.handle;
    // Error middleware (arity 4) is dispatched by handle_error; leave it alone.
    if (typeof fn !== "function" || fn.length > 3)
      return original.call(this, req, res, next);
    let ret;
    try {
      ret = fn.call(this, req, res, next);
    } catch (err) {
      return next(err);
    }
    if (ret && typeof ret.then === "function") ret.then(undefined, next);
    return ret;
  };
  Layer.prototype.__mycityAsyncSafe = true;
}

module.exports = {};
