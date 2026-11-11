"use strict";
/**
 * Training: the pure rules (docs/guides/knowledge.md §6.5 to §6.11) and the routes' guards.
 * Courses, assignments, completion, reminders and 300 people assigned at once run against Postgres
 * in tests/integration/training.test.js.
 *
 * Every person, department and course here is invented.
 */
jest.mock("../../services/ai/llm.service", () => ({ complete: jest.fn() }));

const c = require("@mycity/contract");
const { AppError } = require("../../shared/errors");
const ai = require("../../services/ai/llm.service");
const { youtubeIdOf, toItem, audienceText } = require("./training.service");
const lesson = require("./training.lesson");
const { routesOf } = require("../../http/route");
const actions = require("../../services/ai/actions");

describe("a YouTube link's video id (§6.5)", () => {
  test.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=abc", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ])("%s plays in the course", (url, id) => {
    expect(youtubeIdOf(url)).toBe(id);
  });

  test.each([
    ["http://youtu.be/dQw4w9WgXcQ"],
    ["https://vimeo.com/123456"],
    ["https://www.youtube.com/channel/UC123"],
    ["https://www.youtube.com/watch?v=short"],
    ["https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ"],
    ["not a link"],
    [null],
  ])("%s opens in a new tab", (url) => {
    expect(youtubeIdOf(url)).toBeNull();
  });
});

describe("an item as the screens read it", () => {
  const base = { training_item_id: "00000000-0000-4000-8000-000000000001", position: 1, title: "Item", url: null, document_id: null, lesson_markdown: null, minutes: null };

  test("a video carries its YouTube id; a course link never does", () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    expect(toItem({ ...base, kind: "video", url })).toMatchObject({ youtube_id: "dQw4w9WgXcQ", lesson: null });
    expect(toItem({ ...base, kind: "link", url }).youtube_id).toBeNull();
  });

  test("a lesson is drawn from its Markdown for the reader and the editor, and the item matches the contract", () => {
    const item = toItem({ ...base, kind: "lesson", lesson_markdown: "## Rules\n\n- Lock your screen", minutes: "10" });
    expect(item.lesson.map((b) => b.kind)).toEqual(["heading", "bullets"]);
    expect(item.lesson_html).toBe("<h2>Rules</h2>\n<ul><li>Lock your screen</li></ul>");
    expect(toItem({ ...base, kind: "video", url: "https://youtu.be/dQw4w9WgXcQ" }).lesson_html).toBeNull();
    expect(item.minutes).toBe(10);
    expect(() => c.training.TrainingItem.parse(item)).not.toThrow();
  });

  test("a file names its document only when it has one", () => {
    const doc = "00000000-0000-4000-8000-000000000002";
    expect(toItem({ ...base, kind: "file", document_id: doc, document_name: "a.pdf", document_type: "application/pdf" })).toMatchObject({ document_name: "a.pdf" });
    expect(toItem({ ...base, kind: "link", url: "https://x.example", document_name: "stale" }).document_name).toBeNull();
  });
});

describe("who an assignment reaches, in words", () => {
  const none = { everyone: false, departments: [], roles: [], people: [] };
  test("everyone", () => expect(audienceText({ ...none, everyone: true })).toBe("Everyone"));
  test("departments, roles, then one person by name or people counted", () => {
    expect(audienceText({ ...none, departments: [{ name: "Sales" }], roles: [{ name: "Field Agent" }], people: [{ display_name: "Ada Testcase" }] })).toBe(
      "Sales, Field Agent and Ada Testcase",
    );
    expect(audienceText({ ...none, people: [{ display_name: "A" }, { display_name: "B" }] })).toBe("2 people");
    expect(audienceText(none)).toBe("Nobody");
  });
});

describe("the contract's shapes for Assign Training and Add Proof", () => {
  test("an assignment names who takes it; Keep Assigning is on by default", () => {
    expect(c.training.AssignmentCreate.safeParse({ everyone: false }).success).toBe(false);
    expect(c.training.AssignmentCreate.parse({ everyone: true })).toMatchObject({ keep_assigning: true, department_ids: [] });
  });

  test("proof is a link or a file, never both", () => {
    expect(c.training.ProofAdd.safeParse({ url: "https://x.example", document_id: "00000000-0000-4000-8000-000000000003" }).success).toBe(false);
    expect(c.training.ProofAdd.safeParse({ url: "https://x.example" }).success).toBe(true);
  });
});

describe("Draft Lesson (§6.5)", () => {
  afterEach(() => jest.resetAllMocks());

  test("is registered on the Default job, with personal data, chosen by TB", () => {
    expect(actions.of("training-lesson-draft")).toMatchObject({ job: "default", personal_data: true, chosen_by: "TB", module: "knowledge" });
  });

  test("the model's Markdown is given back without a fence, as the editor loads it; contact details never leave", async () => {
    ai.complete.mockImplementation(async ({ input }) => {
      expect(JSON.stringify(input)).not.toContain("help@mycity.test");
      return { text: "```markdown\n## Your Data\n\nWrite to KEPT001 with questions.\n\n## Key Points\n\n- Ask\n```" };
    });
    const out = await lesson.suggest({ user_id: "u" }, { title: "Data", text: "Write to help@mycity.test with any question about personal data." });
    expect(out.lesson_html).toBe("<h2>Your Data</h2>\n<p>Write to help@mycity.test with questions.</p>\n<h2>Key Points</h2>\n<ul><li>Ask</li></ul>");
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({ purpose: "training-lesson-draft", module: "knowledge" }));
  });

  test("with AI off or not answering it is unavailable, and nothing changes", async () => {
    ai.complete.mockRejectedValue(new AppError("AI_DISABLED", "AI is off", 409));
    await expect(lesson.suggest({ user_id: "u" }, { title: "Data", text: "x".repeat(60) })).rejects.toMatchObject({ code: "AI_UNAVAILABLE", status: 503 });
  });

  test("a source too short to teach from is refused before anything is sent", async () => {
    await expect(lesson.suggest({ user_id: "u" }, { title: "Data", text: "Too short" })).rejects.toMatchObject({ status: 422 });
    expect(ai.complete).not.toHaveBeenCalled();
  });
});

describe("the certificate's page (§6.9)", () => {
  const cert = require("./training.certificate");
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const data = {
    number: "CERT-2026-0019",
    holder_name: "Ifunanya <b>Bello</b>",
    course_title: "Data Protection & the NDPA",
    items: 6,
    items_word: "items",
    length: "2 hours",
    completed_on: "2026-11-30",
    issued_on: "2026-11-30",
    year: "2026",
    signer_name: "Kelechi Nwosu",
    signer_title: "Head, Operations & People",
    signature: png,
    qr: png,
    verify_at: "go.mycityapp.io/verify",
  };
  const org = { name: "MyCity App Ltd", display_name: "MyCity App", logo: null };

  test("prints the approved wording and the facts, every value escaped, and nothing it would fetch", () => {
    const html = cert.draw(data, { org });
    for (const words of ["Certificate", "of Completion", "This is to certify that", "has successfully completed the training", "Published this training", "Learning &amp; Development", "· MYCITY APP LTD · CERTIFIED TRAINING ·"])
      expect(html).toContain(words);
    expect(html).toContain("Ifunanya &lt;b&gt;Bello&lt;/b&gt;");
    expect(html).toContain("Data Protection &amp; the NDPA");
    expect(html).toContain("30 November 2026");
    expect(html).toContain("Issued 30/11/2026");
    expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    expect(html).toContain("data:font/woff2;base64,");
  });

  test("the organisation's logo when Settings has one, else the pin and its name as the wordmark", () => {
    const plain = cert.draw(data, { org });
    expect(plain).toMatch(/<div class="brand-mark"><svg viewBox="0 0 24 24"[^>]*><path fill="#014339" fill-rule="evenodd" d="M12 1\.6c[^"]+"\/><\/svg>MyCity App<\/div>/);
    const withLogo = cert.draw(data, { org: { ...org, logo: png } });
    expect(withLogo).toContain(`<img class="brand-logo" src="${png}"`);
  });

  test("refuses a signature or QR that is not a PNG data URL, and a length is optional", () => {
    expect(() => cert.draw({ ...data, signature: "https://example.org/s.png" }, { org })).toThrow();
    expect(cert.draw({ ...data, length: null }, { org })).not.toContain("About");
  });

  test("a course's length in words", () => {
    expect(cert.lengthOf(null)).toBeNull();
    expect(cert.lengthOf(1)).toBe("1 minute");
    expect(cert.lengthOf(45)).toBe("45 minutes");
    expect(cert.lengthOf(60)).toBe("1 hour");
    expect(cert.lengthOf(100)).toBe("1.5 hours");
    expect(cert.lengthOf(120)).toBe("2 hours");
  });

  test("the seal's ring names the organisation; the petals are 24 lobes", () => {
    expect(cert.sealRing("MyCity App Ltd")).toBe("· MYCITY APP LTD · CERTIFIED TRAINING ·");
    expect(cert.petals(84, 12).match(/M/g)).toHaveLength(24);
  });
});

describe("the routes", () => {
  const routes = routesOf(require("./training.routes").router);

  test("the person's own routes are self; every other route needs the knowledge grant and training.manage", () => {
    expect(routes.length).toBe(24);
    for (const r of routes) {
      if (r.path.startsWith("/me")) {
        expect(r.contract.self).toBe(true);
        expect(r.permission).toBeFalsy();
      } else {
        expect(r.permission && r.permission.key).toBe("knowledge");
        expect(r.capability).toBe("training.manage");
      }
    }
  });

  test("archiving needs delete; creating needs create; every other write needs edit", () => {
    const action = (method, path) => routes.find((r) => r.method === method.toUpperCase() && r.path === path).permission.action;
    expect(action("post", "/courses/:id/archive")).toBe("delete");
    expect(action("post", "/courses")).toBe("create");
    expect(action("post", "/courses/:id/assignments")).toBe("edit");
    expect(action("get", "/courses/:id/people")).toBe("view");
  });
});
