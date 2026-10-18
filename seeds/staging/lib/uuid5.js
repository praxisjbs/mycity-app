"use strict";
/**
 * Name-based ids (RFC 9562 version 5): the same name in the same namespace is always the
 * same id, on every run and every machine. A staging seed gives each row it writes into
 * another module's table such an id, so a second run finds the row it wrote first and the
 * module that later owns the table can delete exactly those rows.
 *
 *   uuid5("partner:mtn-nigeria", HOME_NAMESPACE)  →  the same uuid every time
 *
 * Written on node:crypto rather than a package: the one that does this is not a declared
 * dependency of the backend.
 */
const crypto = require("node:crypto");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} name  what the row is, unique within the namespace
 * @param {string} namespace  a uuid that keeps one seed's names apart from another's
 * @returns {string} a lower-case uuid
 */
function uuid5(name, namespace) {
  if (!UUID_RE.test(String(namespace))) throw new Error(`uuid5: the namespace "${namespace}" is not a uuid`);
  if (typeof name !== "string" || name === "") throw new Error("uuid5: give the row a name");
  const bytes = crypto
    .createHash("sha1")
    .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
    .update(name, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

module.exports = { uuid5 };
