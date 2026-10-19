"use strict";
/**
 * Letter templates: the key a new letter gets, the variables every letter shares, and
 * the routes' grants. Saving, previewing and activating run against Postgres in
 * tests/integration/queries.test.js.
 */
const { routesOf } = require("../../http/route");
const variables = require("../../shared/templates/variables");
const { keyFrom, VARIABLE_NAMES } = require("./templates.service");
const { SHIPPED, declare } = require("./templates.events");

describe("a new letter's key", () => {
  test("made from its name, kebab-case, ending in -letter once", () => {
    expect(keyFrom("Final Warning")).toBe("final-warning-letter");
    expect(keyFrom("Final Warning Letter")).toBe("final-warning-letter");
    expect(keyFrom("  Café & Damage  ")).toBe("cafe-damage-letter");
    expect(keyFrom("!!!")).toBe("letter-letter");
  });

  test("a key the template store accepts", () => {
    expect(keyFrom("A very long name ".repeat(10))).toMatch(/^[a-z][a-z0-9-]{1,63}$/);
  });
});

describe("the letters' variables", () => {
  test("every shipped letter, and any key the screen adds, fills from one schema", () => {
    declare("final-warning-letter");
    for (const key of [...SHIPPED, "final-warning-letter"]) {
      expect(variables.schemaOf("document", key)).toBe(variables.schemaOf("document", "query-letter"));
    }
    expect(VARIABLE_NAMES).toEqual(expect.arrayContaining(["employee", "query_number", "reason", "signer"]));
  });

  test("a template naming something a letter cannot fill is refused", () => {
    expect(() => variables.assertTemplate("document", "warning-letter", "Dear {{ employee.first_name }}")).not.toThrow();
    expect(() => variables.assertTemplate("document", "warning-letter", "Your salary is {{ salary }}")).toThrow(
      expect.objectContaining({ code: "TEMPLATE_UNKNOWN_VARIABLE" }),
    );
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./templates.routes").router);

  test("reads need the queries grant; every write needs queries.configure too", () => {
    expect(routes.length).toBe(7);
    for (const r of routes) {
      expect(r.permission.key).toBe("queries");
      if (r.method === "GET") {
        expect([r.permission.action, r.capability]).toEqual(["view", null]);
      } else {
        expect(["create", "edit"]).toContain(r.permission.action);
        expect(r.capability).toBe("queries.configure");
      }
    }
  });
});
