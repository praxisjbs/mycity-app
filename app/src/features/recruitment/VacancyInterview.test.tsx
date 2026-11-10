// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { dispatch } from "@/api/mock/core";
import { ASSIST } from "@/api/mock/modules/recruitment";
import { copyProblems, dialog, openAs, press, settled, type } from "./testKit";

/**
 * New Vacancy's interview on the in-browser mock (docs/guides/recruitment.md §3 step 2, §9, §10):
 * ten questions one card at a time, only the role required, the AI's two follow-ups, the draft opened
 * in the editor; eight questions and a plain draft when the AI is off; Use Blank Form on every card.
 */

vi.mock("@/api/mock/core", async (importOriginal) => {
  const core = await importOriginal<typeof import("@/api/mock/core")>();
  return { ...core, dispatch: vi.fn(core.dispatch) };
});

expect.extend(axeMatchers);
installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T08:30:00Z"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  cleanup();
  ASSIST.available = true;
  setViewport(1440);
});

/** Opens New Vacancy on Vacancies. */
async function newVacancy() {
  await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
  fireEvent.click(screen.getAllByRole("button", { name: /New Vacancy/ })[0]!);
  await settled();
  return dialog();
}

const question = (form: HTMLElement) => within(form).getByRole("heading", { level: 3 }).textContent;
const counted = (form: HTMLElement) => within(form).getByRole("progressbar").getAttribute("aria-label");

describe("Recruitment · New Vacancy's interview", () => {
  it("asks ten questions one at a time, only the role required, and opens the AI's draft in the editor", async () => {
    let form = await newVacancy();
    expect(question(form)).toBe("What role are you hiring for?");
    expect(counted(form)).toBe("Question 1 of 10");
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();

    // The role is the one answer that is required.
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("What role are you hiring for?");
    type(form, "Job Title", "Data Analyst");
    await press(form, "Next");

    form = dialog();
    expect(question(form)).toBe("Which department is it in, and who leads the hiring?");
    expect(counted(form)).toBe("Question 2 of 10");
    await press(form, "Skip");
    // Back to it: the department and the hiring manager, needed before the editor's Role step passes.
    await press(dialog(), "Back");
    form = dialog();
    await chooseOption(within(form).getByLabelText("Department"), "Engineering");
    fireEvent.click(within(form).getAllByRole("option")[0]!);
    await settled();
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("How many people, and on what terms?");
    await press(form, "Next");

    // A remote role passes over Where, and the count says so.
    form = dialog();
    fireEvent.click(within(within(form).getByRole("radiogroup", { name: "Arrangement" })).getByRole("radio", { name: "Remote" }));
    await settled();
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("What will it pay each month?");
    expect(counted(form)).toBe("Question 5 of 9");
    await press(form, "Skip");

    form = dialog();
    expect(question(form)).toBe("What must they have, and what will they do?");
    type(form, "Your Answer", "Two years with SQL and spreadsheets.\nBuild the weekly figures every team plans by.");
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("Anything else candidates should know?");
    await press(form, "Skip");

    // The AI's two questions, about this role.
    form = dialog();
    expect(question(form)).toBe("Which tools will the Data Analyst use every week?");
    expect(counted(form)).toBe("Question 8 of 9");
    type(form, "Your Answer", "Looker Studio and Google Sheets.");
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("Who will the Data Analyst work with most closely?");
    expect(within(form).queryByRole("button", { name: "Next" })).toBeNull();
    await press(form, "Draft Vacancy");

    // The editor, with the answers and the draft, to check and publish.
    form = dialog();
    expect((within(form).getByLabelText("Job Title") as HTMLInputElement).value).toBe("Data Analyst");
    await press(form, "Next");
    form = dialog();
    const description = (within(form).getByLabelText("Description") as HTMLTextAreaElement).value;
    expect(description).toContain("## Key Responsibilities");
    expect(description).toContain("Looker Studio and Google Sheets.");
    expect((within(form).getByLabelText("Required Experience and Qualifications") as HTMLTextAreaElement).value).toContain("Two years with SQL");
    expect(within(form).queryByLabelText("Location")).toBeNull();
    expect(copyProblems()).toEqual([]);
  }, 120000);

  it("with the AI off, asks the eight fixed questions and drafts plainly from the answers", async () => {
    ASSIST.available = false;
    let form = await newVacancy();
    expect(counted(form)).toBe("Question 1 of 8");
    type(form, "Job Title", "Community Manager");
    await press(form, "Next");
    form = dialog();
    await chooseOption(within(form).getByLabelText("Department"), "Engineering");
    fireEvent.click(within(form).getAllByRole("option")[0]!);
    await settled();
    await press(form, "Next");
    for (let i = 3; i < 8; i++) {
      form = dialog();
      await press(form, /^(Next|Skip)$/);
    }
    form = dialog();
    expect(question(form)).toBe("Anything else candidates should know?");
    expect(counted(form)).toBe("Question 8 of 8");
    await press(form, "Draft Vacancy");
    form = dialog();
    expect((within(form).getByLabelText("Job Title") as HTMLInputElement).value).toBe("Community Manager");
    await press(form, "Next");
    form = dialog();
    expect((within(form).getByLabelText("Description") as HTMLTextAreaElement).value).toMatch(/^MyCityApp is hiring one person as Community Manager/);
    // Write With AI is not offered while the AI is off.
    expect(within(form).queryByRole("button", { name: "Write With AI" })).toBeNull();
  }, 120000);

  it("takes the salary band as a person types it, and sends it with two places", async () => {
    let form = await newVacancy();
    type(form, "Job Title", "Events Coordinator");
    await press(form, "Next");
    form = dialog();
    await chooseOption(within(form).getByLabelText("Department"), "Engineering");
    fireEvent.click(within(form).getAllByRole("option")[0]!);
    await settled();
    await press(form, "Next");
    await press(dialog(), "Next");
    // Remote, so the editor's Role step needs no location.
    form = dialog();
    fireEvent.click(within(within(form).getByRole("radiogroup", { name: "Arrangement" })).getByRole("radio", { name: "Remote" }));
    await settled();
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("What will it pay each month?");
    // Commas and no decimals, as people write a salary: never "Check the format".
    type(form, "Salary From", "350,000");
    type(form, "Salary To", "500000");
    await press(form, "Next");
    form = dialog();
    expect(question(form)).toBe("What must they have, and what will they do?");
    expect(within(form).queryByText("Check the format")).toBeNull();

    for (let i = 0; i < 6 && !within(dialog()).queryByRole("button", { name: "Draft Vacancy" }); i++) await press(dialog(), /^(Next|Skip)$/);
    await press(dialog(), "Draft Vacancy");
    const drafts = vi.mocked(dispatch).mock.calls.map(([r]) => r).filter((r) => r.method === "POST" && r.path === "/api/v1/recruitment/vacancies/assist");
    const interview = (drafts.at(-1)?.body as { interview: { salary_min: string; salary_max: string } }).interview;
    expect([interview.salary_min, interview.salary_max]).toEqual(["350000.00", "500000.00"]);

    // The editor keeps the band as typed and saves it with two places too.
    form = dialog();
    await press(form, "Next");
    form = dialog();
    type(form, "Required Experience and Qualifications", "Two years running events with venue partners.");
    await press(form, "Next");
    form = dialog();
    expect((within(form).getByLabelText("Salary From") as HTMLInputElement).value).toBe("350,000");
    fireEvent.click(within(form).getByRole("checkbox", { name: "Publish Now" }));
    await settled();
    await press(dialog(), "Save Draft");
    const saved = vi.mocked(dispatch).mock.calls.map(([r]) => r).filter((r) => r.method === "POST" && r.path === "/api/v1/recruitment/vacancies");
    expect(saved.at(-1)?.body).toMatchObject({ salary_min: "350000.00", salary_max: "500000.00" });
  }, 120000);

  it("Use Blank Form, on any card, opens the editor with what was answered", async () => {
    let form = await newVacancy();
    type(form, "Job Title", "Studio Producer");
    await press(form, "Next");
    form = dialog();
    expect(within(form).getByRole("button", { name: "Use Blank Form" })).toBeTruthy();
    await press(form, "Use Blank Form");
    form = dialog();
    expect((within(form).getByLabelText("Job Title") as HTMLInputElement).value).toBe("Studio Producer");
    expect(within(form).getByRole("button", { name: "Next" })).toBeTruthy();
    expect(within(form).queryByRole("progressbar")).toBeNull();
  }, 60000);

  it("on a phone, one question a card with its buttons at the foot", async () => {
    setViewport(390);
    const form = await newVacancy();
    expect(question(form)).toBe("What role are you hiring for?");
    for (const name of ["Use Blank Form", "Cancel", "Next"]) expect(within(form).getByRole("button", { name })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);
});
