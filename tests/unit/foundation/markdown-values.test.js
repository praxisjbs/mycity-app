"use strict";
/**
 * Three shared guards the recruitment audit of 04/11/2026 found loose: a value in a Markdown
 * template is escaped once and never becomes Markdown, the AI's no-gap check reads nested lists,
 * and a "+" figure is a phone number only when it has a phone's digits.
 */
const { renderMarkdown, render } = require("../../../src/shared/documents/render");
const drafts = require("../../../src/services/ai/drafts");
const redact = require("../../../src/services/ai/redact");
const c = require("@mycity/contract");

describe("renderMarkdown", () => {
  test("escapes a value exactly once", () => {
    const html = renderMarkdown("Hello {{ name }}, {{ role }}.", { name: "O'Brien", role: "Sales & Revenue" });
    expect(html).toBe("<p>Hello O&#39;Brien, Sales &amp; Revenue.</p>");
  });

  test("a value never becomes a link, bold, a heading or a table", () => {
    const html = renderMarkdown("{{ v }}", { v: "# [Pay Here](https://evil.example.test) **now** | x |" });
    expect(html).not.toMatch(/<a |<strong>|<h1>|<table>/);
    expect(html).toContain("# [Pay Here](https://evil.example.test) **now** | x |");
  });

  test("the template's own Markdown still works around a value, and a link may take one", () => {
    const html = renderMarkdown("**Starts:** {{ when }}\n\n[Join the Interview]({{ url }})", {
      when: "10/11/2026 10:00",
      url: "https://meet.example.test/abc-defg_hij?a=1&b=2",
    });
    expect(html).toContain("<strong>Starts:</strong> 10/11/2026 10:00");
    expect(html).toContain('href="https://meet.example.test/abc-defg_hij?a=1&amp;b=2"');
  });

  test("a value's new line is a space, so it cannot start a block", () => {
    expect(renderMarkdown("{{ v }}", { v: "one\n- two" })).toBe("<p>one - two</p>");
  });

  test("an HTML template still escapes its values as before", () => {
    expect(render("<p>{{ v }}</p>", { v: "a & b" })).toBe("<p>a &amp; b</p>");
  });
});

describe("drafts.readyToUse", () => {
  const shield = redact.shield({});
  test("refuses a gap or an invented token inside a nested list", () => {
    const schema = drafts.readyToUse(c.vacancies.QuestionsDraftOutput, shield);
    const r = schema.safeParse({ application: [{ prompt: "Which [city] can you work in? Email KEPT009." }], interview: [] });
    expect(r.success).toBe(false);
    const paths = r.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("application.0.prompt");
  });

  test("passes clean nested text", () => {
    const schema = drafts.readyToUse(c.vacancies.QuestionsDraftOutput, shield);
    expect(schema.safeParse({ application: [{ prompt: "Which city can you work in?" }], interview: [] }).success).toBe(true);
  });
});

describe("redact: phones", () => {
  test.each([
    ["Phone +234 803 123 4567", false],
    ["+44 20 7946 0958", false],
    ["Grew revenue +1500%", true],
    ["sales +2000 2023 targets", true],
  ])("%s kept as written: %s", (text, kept) => {
    expect(redact.shield({ t: text }).value.t === text).toBe(kept);
  });
});
