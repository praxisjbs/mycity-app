"use strict";
/**
 * The imports module's rules that need no database: what an importer looks like
 * to the screen, and the gates on every route. The wizard and the history run
 * against Postgres in tests/integration/documents-api.test.js.
 */
const { z } = require("zod");
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const registry = require("../../shared/import/registry");
const service = require("./imports.service");

const SPEC = {
  key: "test_things",
  label: "Things",
  permission: ["people", "create"],
  entity: "test_thing",
  schema: z.object({ name: z.string() }).strict(),
  matchKeys: ["name"],
  fields: [
    { key: "name", label: "Name", required: true, aliases: ["thing name"], example: "Kettle" },
    { key: "colour", label: "Colour", type: "enum", options: ["red", { value: "blue", label: "Blue" }] },
    { key: "owner", label: "Owner", type: "reference", ref: "employee", pass: 2 },
    { key: "cost", label: "Cost", type: "money", mask: "employee.salary" },
    { key: "team", label: "Team", type: "reference", ref: "department", createMissing: "confirm" },
  ],
  find: () => null,
  write: () => ({ id: "1" }),
  archive: () => undefined,
  restore: () => undefined,
  resolve: () => null,
  create: () => "1",
  link: () => undefined,
};

describe("an importer as the screen reads it", () => {
  let shaped;
  beforeAll(() => {
    registry.defineImporter(SPEC);
    shaped = service.importerOf(registry.get("test_things"));
  });
  afterAll(() => registry.__reset());

  test("its own key, label and what it writes, with the permission spelt out", () => {
    expect(shaped).toMatchObject({
      key: "test_things",
      label: "Things",
      entity: "test_thing",
      permission: "people.create",
      match_keys: ["name"],
    });
  });

  test("every field carries what the Map step needs, and nothing executable", () => {
    expect(shaped.fields[0]).toEqual({
      key: "name",
      label: "Name",
      type: "text",
      required: true,
      aliases: ["thing name"],
      options: [],
      ref: null,
      pass: 1,
      create_missing: false,
      masked: false,
      example: "Kettle",
      hint: null,
    });
    expect(JSON.stringify(shaped)).not.toContain("function");
  });

  test("choices come back as value and label, however they were declared", () => {
    expect(shaped.fields[1].options).toEqual([
      { value: "red", label: "red" },
      { value: "blue", label: "Blue" },
    ]);
  });

  test("a reference says what it points at, which pass it waits for, and whether it may create", () => {
    expect(shaped.fields[2]).toMatchObject({ ref: "employee", pass: 2, create_missing: false });
    expect(shaped.fields[4]).toMatchObject({ ref: "department", create_missing: true });
  });

  test("a masked column says so without naming the mask", () => {
    expect(shaped.fields[3]).toMatchObject({ masked: true, type: "money" });
    expect(shaped.fields[3]).not.toHaveProperty("mask");
  });

  test("the shape is the contract's", () => {
    expect(c.imports.Importer.safeParse(shaped).success).toBe(true);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./imports.routes").router);
  const find = (method, path) =>
    routes.find((r) => r.method === method.toUpperCase() && r.path === path);

  test("the history is the settings grant", () => {
    expect(find("get", "/").permission).toEqual({ key: "settings", action: "view" });
  });

  test("a wizard route carries no grant of its own: the importer's is checked in the service", () => {
    for (const [method, path] of [
      ["get", "/importers"],
      ["post", "/"],
      ["put", "/:id/mapping"],
      ["post", "/:id/preview"],
      ["post", "/:id/commit"],
      ["post", "/:id/revert"],
    ]) {
      const route = find(method, path);
      expect(route.permission).toBeNull();
      expect(route.contract.self).toBe(true);
    }
  });

  test("the two spreadsheet routes answer with a file, not a shape", () => {
    expect(find("get", "/importers/:key/template").contract.no_content).toBe(true);
    expect(find("get", "/:id/report").contract.no_content).toBe(true);
  });

  test("every list pages through the contract's list controls", () => {
    for (const route of routes.filter((r) => r.contract.query)) {
      expect(Object.keys(route.contract.query.shape)).toContain("page");
    }
  });
});
