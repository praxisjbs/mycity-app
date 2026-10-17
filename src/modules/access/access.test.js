"use strict";
/**
 * Access rules that need no database: how a role's grants are checked before they
 * are saved, and the lists the contract repeats from the code. Saving, deleting and
 * the effect on a person's access run in tests/integration/settings.test.js.
 */
const c = require("@mycity/contract");
const catalog = require("../../shared/access/access.catalog");
const { FIELD_KEYS } = require("../../shared/rbac/field-mask");
const { grantRows } = require("./access.service");

const fieldsOf = (fn) => {
  try {
    fn();
    return null;
  } catch (err) {
    return err.fields;
  }
};

describe("a role's grants", () => {
  test("become one permission row per module, each action a column", () => {
    const rows = grantRows([
      { module_key: "people", scope: "team", actions: ["view", "edit"] },
      { module_key: "home", scope: "all", actions: ["view"] },
    ]);
    expect(rows).toEqual([
      { module_key: "home", scope: "all", can_view: true, can_create: false, can_edit: false, can_delete: false, can_approve: false, can_export: false },
      { module_key: "people", scope: "team", can_view: true, can_create: false, can_edit: true, can_delete: false, can_approve: false, can_export: false },
    ]);
  });

  test("Self-Service is always the person's own, whatever the grant says", () => {
    expect(grantRows([{ module_key: "ess", scope: "all", actions: ["view"] }])[0].scope).toBe("own");
  });

  test("a module with no actions is not granted", () => {
    const rows = grantRows([
      { module_key: "home", scope: "all", actions: ["view"] },
      { module_key: "payroll", scope: "all", actions: [] },
    ]);
    expect(rows.map((r) => r.module_key)).toEqual(["home"]);
  });

  test("every action needs view, a module once, a module that exists, and at least one", () => {
    expect(fieldsOf(() => grantRows([{ module_key: "people", scope: "all", actions: ["edit"] }]))).toEqual({
      grants: ["Every action needs View"],
    });
    expect(
      fieldsOf(() =>
        grantRows([
          { module_key: "home", scope: "all", actions: ["view"] },
          { module_key: "home", scope: "own", actions: ["view"] },
        ]),
      ),
    ).toEqual({ grants: ["A module twice"] });
    expect(fieldsOf(() => grantRows([{ module_key: "ledger", scope: "all", actions: ["view"] }]))).toEqual({
      grants: ["Unknown module"],
    });
    expect(fieldsOf(() => grantRows([]))).toEqual({ grants: ["Grant a module"] });
  });
});

describe("the lists the contract repeats", () => {
  test("the field groups are field-mask's", () => {
    expect([...c.access.FIELD_KEYS]).toEqual(FIELD_KEYS.map((f) => f.key));
  });

  test("the actions are the catalogue's", () => {
    expect([...c.identity.ACTIONS]).toEqual(catalog.ACTIONS);
    expect(c.access.RecordScope.options).toEqual(catalog.RECORD_SCOPES);
  });

  test("a role is saved whole: name, grants, fields and capabilities", () => {
    const ok = c.access.RoleSave.safeParse({
      name: "Studio Lead",
      grants: [{ module_key: "people", scope: "team", actions: ["view"] }],
      visible_fields: ["employee.salary"],
      capabilities: ["announcements.post"],
    });
    expect(ok.success).toBe(true);
    expect(c.access.RoleSave.safeParse({ name: "S", grants: [], visible_fields: [], capabilities: [] }).success).toBe(
      false,
    );
    expect(
      c.access.RoleSave.safeParse({ name: "Studio", grants: [], visible_fields: [], capabilities: [], home_view: "ceo" })
        .success,
    ).toBe(false);
  });
});
