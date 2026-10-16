"use strict";
/**
 * ⌘K: logins by name or email, for people who manage Settings · Users. A result
 * opens the Users screen on that login.
 */
const { recordProvider } = require("../../shared/search/provider");

module.exports = recordProvider({
  type: "app_user",
  module: "settings",
  label: "Users",
  words: ["user", "login", "account", "invite"],
  from: "app_user u JOIN employee e ON e.employee_id = u.employee_id",
  key: "u.user_id",
  columns: ["e.first_name", "e.last_name", "u.email"],
  select:
    "u.user_id AS id, u.email::text AS ref, trim(e.first_name || ' ' || e.last_name) AS title, e.job_title AS sub",
});
