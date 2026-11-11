"use strict";
/**
 * SOPs: the pure rules (docs/guides/knowledge.md §6.3, §6.4) and the routes. Who writes, drafts,
 * publishing, archiving and Draft With AI run against Postgres in
 * tests/integration/knowledge-sops.test.js.
 *
 * Every department, person and procedure here is invented.
 */
jest.mock("../../services/ai/llm.service", () => ({ complete: jest.fn() }));

const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const { routesOf } = require("../../http/route");
const actions = require("../../services/ai/actions");
const v = require("./knowledge.versions");
const draft = require("./knowledge.draft");

const DEPT = "8b1f6a40-0000-4000-8000-000000000001";

describe("a step's screen", () => {
  test("a route map screen, named as the hub shows it", () => {
    expect(v.screenOf("people/employees")).toEqual({ module: "people", tab: "employees", label: "People · Employees" });
    expect(v.screenOf("praxis_ai/ask")).toEqual({ module: "praxis_ai", tab: "ask", label: "Praxis AI · Ask" });
    expect(v.screenOf("knowledge/sops").label).toBe("Knowledge Hub · SOPs");
  });

  test("a key the route map does not know resolves to nothing, so its link is dropped (§11)", () => {
    for (const key of ["people/nowhere", "nowhere/employees", "people", "people/employees/extra", "", null]) expect(v.screenOf(key)).toBeNull();
  });
});

describe("steps and versions as staff read them", () => {
  const row = { position: 2, text: "Email the **brief** to *Design*.", who: "Campaign Lead", screen_key: "people/employees", document_id: null, document_name: null };

  test("a step carries its Markdown, the blocks the reader draws, and its screen's name", () => {
    const step = v.stepOut(row);
    expect(c.knowledge.SopStep.parse(step)).toEqual(step);
    expect(step).toMatchObject({ position: 2, who: "Campaign Lead", screen_label: "People · Employees", document_id: null, document_name: null });
    expect(step.blocks).toEqual([
      {
        kind: "paragraph",
        spans: [
          { text: "Email the ", bold: false, italic: false, href: null },
          { text: "brief", bold: true, italic: false, href: null },
          { text: " to ", bold: false, italic: false, href: null },
          { text: "Design", bold: false, italic: true, href: null },
          { text: ".", bold: false, italic: false, href: null },
        ],
      },
    ]);
  });

  test("a step's raw HTML stays its text: one plain span the reader draws as words, never markup", () => {
    const step = v.stepOut({ ...row, text: "<script>alert(1)</script> Then file it." });
    expect(step.blocks).toEqual([{ kind: "paragraph", spans: [{ text: "<script>alert(1)</script> Then file it.", bold: false, italic: false, href: null }] }]);
  });

  test("a step whose screen left the route map keeps its key and loses its link; a file keeps its name", () => {
    expect(v.stepOut({ ...row, screen_key: "people/gone" })).toMatchObject({ screen_key: "people/gone", screen_label: null });
    expect(v.stepOut({ ...row, document_id: DEPT, document_name: "brief.pdf" })).toMatchObject({ document_id: DEPT, document_name: "brief.pdf" });
  });

  test("two versions say the same thing when their fields and steps do, in order", () => {
    const a = v.contentOf({ title: "Launch", purpose: "Why we launch.", scope: null, roles: ["Lead"] }, [row, { ...row, position: 3, text: "Ship it." }]);
    const b = v.contentOf({ title: "Launch", purpose: "Why we launch.", scope: "", roles: ["Lead"] }, [{ ...row, document_name: "x" }, { ...row, position: 3, text: "Ship it." }]);
    expect(v.sameContent(a, b)).toBe(true);
    expect(v.sameContent(a, { ...b, steps: [...b.steps].reverse() })).toBe(false);
    expect(v.sameContent(a, { ...b, roles: ["Lead", "Designer"] })).toBe(false);
    const saved = v.draftOut({ sop_version_id: DEPT, title: "Launch", purpose: "Why we launch.", scope: null, roles: ["Lead"], updated_at: "2026-11-11T09:00:00Z" }, [row], a);
    expect(saved.has_changes).toBe(true);
    expect(v.draftOut({ sop_version_id: DEPT, title: "Launch", roles: [] }, [], null).has_changes).toBe(true);
  });

  test("the hash is over what staff read: the number, department and version are in it", () => {
    const content = v.contentOf({ title: "Launch", purpose: "Why we launch.", scope: null, roles: [] }, [row]);
    const sop = { number: "SOP-0001", department_id: DEPT };
    expect(v.hashOf(sop, content, 1)).toMatch(/^[0-9a-f]{64}$/);
    expect(v.hashOf(sop, content, 2)).not.toBe(v.hashOf(sop, content, 1));
    expect(v.hashOf({ ...sop, number: "SOP-0002" }, content, 1)).not.toBe(v.hashOf(sop, content, 1));
  });

  test("an SOP's state: archived, published with a version in force, else a draft", () => {
    expect(v.stateOf("archived", 3)).toBe("archived");
    expect(v.stateOf("active", 1)).toBe("published");
    expect(v.stateOf("active", null)).toBe("draft");
    const r = v.rowOut({ sop_id: DEPT, number: "SOP-0001", title: "Launch", department_id: DEPT, department_name: "Marketing", status: "active", version: "2", has_draft: true, updated_at: new Date("2026-11-11T09:00:00Z") });
    expect(c.knowledge.SopRow.parse(r)).toEqual(r);
    expect(r).toMatchObject({ state: "published", version: 2, has_draft: true, updated_at: "2026-11-11T09:00:00.000Z" });
  });
});

describe("Draft With AI's answer", () => {
  test("held to the form's limits, the shield's tokens put back, empty steps dropped", () => {
    const restore = (s) => String(s).replace("KEPT001", "ada@mycity.test");
    const out = draft.shaped(
      {
        title: "T".repeat(130),
        purpose: "Email KEPT001 first.",
        scope: "",
        roles: [...Array.from({ length: 12 }, (_, i) => `Role ${i}`), ""],
        steps: [{ text: "Ok", who: null }, { text: "Write to KEPT001.", who: "Lead" }, ...Array.from({ length: 60 }, (_, i) => ({ text: `Step number ${i}`, who: null }))],
      },
      restore,
    );
    expect(out.title).toHaveLength(120);
    expect(out.purpose).toBe("Email ada@mycity.test first.");
    expect(out.scope).toBeNull();
    expect(out.roles).toHaveLength(10);
    expect(out.steps).toHaveLength(50);
    expect(out.steps[0]).toEqual({ text: "Write to ada@mycity.test.", who: "Lead" });
    expect(c.knowledge.SopDraftSuggestion.parse(out)).toEqual(out);
  });

  test("a long text is cut at a word", () => {
    expect(draft.fit("one two three four", 9)).toBe("one two");
    expect(draft.fit("  short  ", 20)).toBe("short");
  });

  test("its action is registered on the Default job, personal data, chosen by TB, with its prompt", () => {
    expect(actions.of("sop-draft")).toMatchObject({ module: "knowledge", job: "default", personal_data: true, chosen_by: "TB", chosen_at: "2026-11-11", built: true });
    const prompt = fs.readFileSync(path.join(__dirname, "../../services/ai/prompts/sop-draft.md"), "utf8");
    expect(prompt).toMatch(/^---\nversion: \d+\n---\n/);
    expect(prompt).toMatch(/never add a step/i);
  });
});

describe("the contract", () => {
  test("Save Draft: a purpose of 10 characters or none; up to 10 roles and 50 steps", () => {
    const base = { title: "Campaign Launch", roles: [], steps: [] };
    expect(c.knowledge.SopDraftSave.safeParse(base).success).toBe(true);
    expect(c.knowledge.SopDraftSave.safeParse({ ...base, purpose: "" }).success).toBe(true);
    expect(c.knowledge.SopDraftSave.safeParse({ ...base, purpose: "Too short" }).success).toBe(false);
    expect(c.knowledge.SopDraftSave.safeParse({ ...base, roles: Array(11).fill("Lead") }).success).toBe(false);
    expect(c.knowledge.SopDraftSave.safeParse({ ...base, steps: Array(51).fill({ text: "Do it." }) }).success).toBe(false);
    expect(c.knowledge.SopDraftSave.safeParse({ ...base, steps: [{ text: "Do it.", screen_key: "People" }] }).success).toBe(false);
  });

  test("Draft With AI takes a pasted procedure or a PDF, never both", () => {
    expect(c.knowledge.SopDraftWithAi.safeParse({ department_id: DEPT, text: "Brief the team." }).success).toBe(true);
    expect(c.knowledge.SopDraftWithAi.safeParse({ department_id: DEPT, document_id: DEPT }).success).toBe(true);
    expect(c.knowledge.SopDraftWithAi.safeParse({ department_id: DEPT }).success).toBe(false);
    expect(c.knowledge.SopDraftWithAi.safeParse({ department_id: DEPT, text: "Brief the team.", document_id: DEPT }).success).toBe(false);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./knowledge.routes").router);
  const by = (method, p) => routes.find((r) => r.method === method && r.path === p);

  test("every route asks the knowledge view grant and no capability: the writer rule is the service's (§6.2)", () => {
    expect(routes).toHaveLength(12);
    for (const r of routes) {
      expect(r.permission).toEqual(expect.objectContaining({ key: "knowledge", action: "view" }));
      expect(r.capability).toBeFalsy();
    }
  });

  test("the static paths come before /sops/:id", () => {
    const order = routes.map((r) => `${r.method} ${r.path}`);
    expect(order.indexOf("GET /sops/for-screen")).toBeLessThan(order.indexOf("GET /sops/:id"));
    expect(order.indexOf("GET /sops/versions/:id")).toBeLessThan(order.indexOf("GET /sops/:id"));
    expect(order.indexOf("GET /sops/departments")).toBeLessThan(order.indexOf("GET /sops/:id"));
    expect(by("POST", "/sops/draft-with-ai")).toBeTruthy();
    expect(by("PUT", "/sops/:id/draft")).toBeTruthy();
  });
});
