// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import training from "@mycity/contract/schemas/training.js";
import common from "@mycity/contract/schemas/common.js";
import documents from "@mycity/contract/schemas/documents.js";
import "../index";
import { dispatch, mockSession } from "../core";

/**
 * The training mock answers in the contract's shapes (FRONTEND_GUIDE §9.5, F12): every route the
 * two screens call is asked and its answer parsed with the schema the API itself answers with
 * (docs/guides/knowledge.md §5), and its refusals are the API's.
 */
type Body = Record<string, unknown>;
const ask = (method: string, path: string, body: Body = {}, query: Body = {}) => dispatch({ method, path, query, body, headers: { Authorization: "Bearer mock.test" } });
const as = (user: string) => mockSession.set(user);
const COURSE_PAGE = training.CoursePage;

let firstCourse = "";
beforeAll(async () => {
  as("cynthia");
  const r = await ask("GET", "/api/v1/training/courses", {}, { state: "published" });
  firstCourse = (r.body as { data: Array<{ training_course_id: string; title: string }> }).data.find((c) => c.title === "Data Protection Essentials")!.training_course_id;
});

describe("the training mock", () => {
  it("lists courses for training.manage only, filtered and sorted as the contract allows", async () => {
    as("cynthia");
    const all = await ask("GET", "/api/v1/training/courses", {}, { sort: "title" });
    expect(all.status).toBe(200);
    const page = COURSE_PAGE.parse(all.body);
    expect(page.data.map((c) => c.state)).toEqual(expect.arrayContaining(["draft", "published", "archived"]));
    expect((await ask("GET", "/api/v1/training/courses", {}, { sort: "items" })).status).toBe(422);
    as("chidera");
    expect((await ask("GET", "/api/v1/training/courses")).status).toBe(403);
  });

  it("answers a course, its people and its assignments in the contract's shapes", async () => {
    as("cynthia");
    const course = training.Course.parse((await ask("GET", `/api/v1/training/courses/${firstCourse}`)).body);
    expect(course.items.map((i) => i.kind)).toEqual(["file", "video", "lesson", "link"]);
    expect(course.items[1]!.youtube_id).toBe("M7lc1UVf-VE");
    expect(course.items[2]!.lesson!.map((b) => b.kind)).toEqual(["heading", "paragraph", "heading", "bullets"]);
    const people = training.EnrolmentPage.parse((await ask("GET", `/api/v1/training/courses/${firstCourse}/people`, {}, { status: "completed" })).body);
    expect(people.data.every((p) => p.status === "completed" && p.certificate_ready)).toBe(true);
    training.AssignmentPage.parse((await ask("GET", `/api/v1/training/courses/${firstCourse}/assignments`)).body);
  });

  it("builds a course to publication: items, order, settings, Draft Lesson and a signature", async () => {
    as("cynthia");
    const made = await ask("POST", "/api/v1/training/courses", { title: "First Aid Basics", summary: "What to do first." });
    expect(made.status).toBe(201);
    const c = training.Course.parse(made.body);
    expect((await ask("POST", `/api/v1/training/courses/${c.training_course_id}/publish`, { signature: "data:image/png;base64,AAAA" })).body).toMatchObject({ error: { code: "NO_ITEMS" } });
    const short = await ask("POST", `/api/v1/training/courses/${c.training_course_id}/items`, { kind: "lesson", title: "Short", lesson_html: "<p>Too short</p>" });
    expect(short.body).toMatchObject({ error: { fields: { lesson_html: ["At least 20 characters"] } } });
    const suggestion = training.LessonSuggestion.parse((await ask("POST", "/api/v1/training/lesson-with-ai", { title: "Burns", text: "Cool a burn under running water for twenty minutes. Never use ice. Cover it loosely." })).body);
    await ask("POST", `/api/v1/training/courses/${c.training_course_id}/items`, { kind: "lesson", title: "Burns", lesson_html: suggestion.lesson_html, minutes: 5 });
    const two = training.Course.parse((await ask("POST", `/api/v1/training/courses/${c.training_course_id}/items`, { kind: "video", title: "Recovery Position", url: "https://youtu.be/M7lc1UVf-VE" })).body);
    const order = two.items.map((i) => i.training_item_id).reverse();
    const reordered = training.Course.parse((await ask("PUT", `/api/v1/training/courses/${c.training_course_id}/order`, { item_ids: order })).body);
    expect(reordered.items.map((i) => i.title)).toEqual(["Recovery Position", "Burns"]);
    expect(reordered.minutes).toBe(5);
    training.Course.parse((await ask("PATCH", `/api/v1/training/courses/${c.training_course_id}`, { library: true, proof_required: true, proof_prompt: "Paste your certificate link" })).body);
    const published = training.Course.parse((await ask("POST", `/api/v1/training/courses/${c.training_course_id}/publish`, { signature: "data:image/png;base64,AAAA" })).body);
    expect(published).toMatchObject({ state: "published", signer_name: "Cynthia Osakunih" });
    const a = training.Assignment.parse((await ask("POST", `/api/v1/training/courses/${c.training_course_id}/assignments`, { everyone: false, department_ids: [], role_ids: [], employee_ids: [published.training_course_id.replace(/./, "0")], due_within_days: 7, keep_assigning: true })).body ?? {});
    expect(a.keep_assigning).toBe(false);
    const withdrawn = training.Assignment.parse((await ask("POST", `/api/v1/training/assignments/${a.training_assignment_id}/withdraw`)).body);
    expect(withdrawn.withdrawn_at).not.toBeNull();
    const archived = training.Course.parse((await ask("POST", `/api/v1/training/courses/${c.training_course_id}/archive`, { reason: "Replaced by the new course" })).body);
    expect(archived).toMatchObject({ state: "archived", library: false });
    expect((await ask("PATCH", `/api/v1/training/courses/${c.training_course_id}`, { title: "Renamed Course" })).body).toMatchObject({ error: { code: "COURSE_ARCHIVED" } });
  });

  it("takes a person through My Training: their lists, Mark Done, Undone, proof and the certificate", async () => {
    as("cynthia");
    for (const list of ["to_do", "in_progress", "completed", "library"]) {
      const page = training.MyCoursePage.parse((await ask("GET", "/api/v1/training/me", {}, { list })).body);
      expect(page.data.length).toBeGreaterThan(0);
    }
    const library = training.MyCoursePage.parse((await ask("GET", "/api/v1/training/me", {}, { list: "library" })).body).data[0]!;
    const before = training.MyCourse.parse((await ask("GET", `/api/v1/training/me/courses/${library.training_course_id}`)).body);
    expect(before.enrolled).toBe(false);
    expect((await ask("POST", `/api/v1/training/me/items/${before.items[0]!.training_item_id}/done`)).body).toMatchObject({ error: { code: "NOT_STARTED" } });
    let mine = training.MyCourse.parse((await ask("POST", `/api/v1/training/me/courses/${library.training_course_id}/start`)).body);
    expect(mine.status).toBe("in_progress");
    for (const i of mine.items) mine = training.MyCourse.parse((await ask("POST", `/api/v1/training/me/items/${i.training_item_id}/done`)).body);
    expect(mine.completed_at).toBeNull();
    expect(mine.proof_required).toBe(true);
    expect((await ask("POST", `/api/v1/training/me/courses/${library.training_course_id}/proof`, { url: "http://not-secure.example" })).status).toBe(422);
    mine = training.MyCourse.parse((await ask("POST", `/api/v1/training/me/courses/${library.training_course_id}/proof`, { url: "https://learn.example.com/certificates/1" })).body);
    expect(mine).toMatchObject({ status: "completed", certificate_ready: true });
    expect((await ask("POST", `/api/v1/training/me/items/${mine.items[0]!.training_item_id}/undone`)).body).toMatchObject({ error: { code: "COURSE_COMPLETED" } });
    const file = await ask("POST", `/api/v1/training/me/courses/${library.training_course_id}/certificate`);
    expect(file.status).toBe(202);
    documents.ExportFile.parse(file.body);
    as("chidera");
    expect((await ask("GET", `/api/v1/training/me/courses/${common.IdParams.parse({ id: firstCourse }).id}`)).status).toBe(200);
  });
});
