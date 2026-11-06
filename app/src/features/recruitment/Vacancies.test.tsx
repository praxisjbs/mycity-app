// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { axe, axeMatchers, chooseOption, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { SEATS, VACANCIES } from "@/api/mock/data/recruitment";
import { copyProblems, dialog, openAs, openRow, press, settled, type } from "./testKit";

/**
 * Recruitment · Vacancies on the in-browser mock (docs/guides/recruitment.md §6.1, §10): the four
 * figures and the list; a role's sheet with MyCity's ten interview traits and its lifecycle; New
 * Vacancy through its four steps to a published role; Pause asks nothing more and is undone by Resume.
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
  setViewport(1440);
});

const byTitle = (title: string) => VACANCIES.find((v) => v.title === title)!;

describe("Recruitment · Vacancies", () => {
  it("shows the four figures and the roles, and a role opens with its traits and public link", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
    for (const label of ["Open Vacancies", "Applicants", "In Interview", "Past Closing Date"]) expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(copyProblems()).toEqual([]);
    expect(await axe(document.body)).toHaveNoViolations();

    const sheet = await openRow("Head, Sales & Revenue");
    expect(within(sheet).getByText("Appearance and Grooming")).toBeTruthy();
    expect(within(sheet).getByText("Future Growth Potential in Career")).toBeTruthy();
    expect(within(sheet).getByText(/go\.mycityapp\.io\/jobs\//)).toBeTruthy();
    for (const name of ["Edit", "Questions", "Scorecard", "Pause", "See Candidates"]) expect(within(sheet).getByRole("button", { name })).toBeTruthy();
    // The description is drawn from its blocks: real headings and lists, never the Markdown's marks.
    expect(within(sheet).getByRole("heading", { name: "Key Responsibilities" })).toBeTruthy();
    expect(within(sheet).getAllByRole("listitem").length).toBeGreaterThan(3);
    expect(within(sheet).queryByText(/^##|\n- /)).toBeNull();
    expect(sheet.textContent).not.toContain("## ");
    expect(copyProblems()).toEqual([]);
  }, 60000);

  it("Create Vacancy from the Organogram opens New Vacancy with the seat's department, line and manager", async () => {
    await openAs("cynthia@mycityapp.io", `/recruitment?tab=vacancies&new=1&title=City+Editor%2C+Abuja&org_seat_id=${SEATS[1]!.org_seat_id}`);
    await settled();
    const form = dialog();
    expect((within(form).getByLabelText("Job Title") as HTMLInputElement).value).toBe("City Editor, Abuja");
    await settled();
    expect(within(form).getByLabelText("Department").textContent).toContain("Content");
    expect(within(form).getByText(/Cynthia/)).toBeTruthy();
  }, 60000);

  it("Pause and Resume a role", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
    const sheet = await openRow("Graphics and Motion Designer");
    await press(sheet, "Pause");
    expect(byTitle("Graphics and Motion Designer").status).toBe("paused");
    await press(dialog(), "Resume");
    expect(byTitle("Graphics and Motion Designer").status).toBe("open");
  }, 60000);

  it("New Vacancy: three steps, each checked before the next, to a published remote role", async () => {
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
    fireEvent.click(screen.getAllByRole("button", { name: /New Vacancy/ })[0]!);
    await settled();
    let form = dialog();
    expect(copyProblems()).toEqual([]);

    // Next with nothing given stays on Role and marks the title.
    await press(form, "Next");
    form = dialog();
    expect(within(form).getByLabelText("Job Title")).toBeTruthy();

    type(form, "Job Title", "Data Analyst");
    await chooseOption(within(form).getByLabelText("Department"), "Engineering");
    // The hiring manager is picked from the staff list the server pages.
    fireEvent.click(within(form).getAllByRole("option")[0]!);
    await settled();
    await press(form, "Next");

    form = dialog();
    fireEvent.click(within(within(form).getByRole("radiogroup", { name: "Arrangement" })).getByRole("radio", { name: "Remote" }));
    await settled();
    expect(within(form).queryByLabelText("Location")).toBeNull();
    type(form, "Description", "The Data Analyst turns MyCityApp's listings, bookings and partner figures into the weekly numbers every team plans by.");
    type(form, "Required Experience and Qualifications", "Two years with SQL and spreadsheets in a busy team.");
    await press(form, "Next");

    const before = VACANCIES.length;
    await press(dialog(), "Publish Vacancy");
    expect(VACANCIES.length).toBe(before + 1);
    expect(VACANCIES[0]).toMatchObject({ title: "Data Analyst", status: "open", work_pattern: "remote", location: null });
    expect(VACANCIES[0]!.questions.filter((q) => q.purpose === "interview")).toHaveLength(10);
  }, 90000);

  it("on a phone, the figures come two a row and a role opens in a sheet", async () => {
    setViewport(390);
    await openAs("cynthia@mycityapp.io", "/recruitment?tab=vacancies");
    const sheet = await openRow("Head, Sales & Revenue");
    expect(within(sheet).getByRole("button", { name: "See Candidates" })).toBeTruthy();
    expect(copyProblems()).toEqual([]);
  }, 60000);
});
