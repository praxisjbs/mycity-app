// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Assessment } from "./Assessment";

/**
 * Assessment on the in-browser mock, as the staff mock holds the sittings: Chinedu's Sales Scenario
 * Case Study not started, Funke's Work Style Profile running on its second question, Segun's take-home
 * Graphics and Motion Design Brief (MyCity's own), Ngozi's brief submitted, and Emeka's case timed out.
 */
const draw = (token: string) =>
  render(
    <RouterProvider>
      <Assessment token={token} />
    </RouterProvider>,
  );

const question = (n: number, of: number) => screen.findByRole("heading", { level: 1, name: `Question ${n} of ${of}` });

describe("Assessment", () => {
  it("opens on its intro, and Start the Assessment puts the first question under the clock", async () => {
    draw("Px2mL9vQe4Ty");
    expect(await screen.findByRole("heading", { level: 1, name: "Sales Scenario Case Study" })).toBeTruthy();
    expect(screen.getByText(/^Hello Ngozi\./)).toBeTruthy();
    const facts = screen.getByRole("list", { name: "About the Assessment" });
    for (const t of ["Case Study", "60 minutes", "3"]) expect(within(facts).getByText(t)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 3);
    expect(screen.getByRole("timer")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Your Answer"), { target: { value: "Weekday lunch guides for each branch, with a booking offer." } });
    expect(await screen.findByText("Saved", {}, { timeout: 4000 })).toBeTruthy();
  });

  it("resumes where it was, saves a choice as it is made, and moves between questions to Submit", async () => {
    draw("Hb6tZ3qNw8Rk");
    await question(2, 3);
    fireEvent.click(screen.getByRole("radio", { name: "Disagree" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await question(1, 3);
    /* The first answer was already saved, so it shows chosen. */
    expect(screen.getByRole("radio", { name: "Agree" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(2, 3);
    expect(screen.getByRole("radio", { name: "Disagree" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(3, 3);

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Submit Assessment" });
    expect(within(dialog).getByText("You answered 2 of 3 questions. Answers cannot change after this.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Assessment" }));
    expect(await screen.findByRole("heading", { name: "Assessment Submitted" })).toBeTruthy();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("a take-home brief has a due day, no clock, and takes a file or a link", async () => {
    draw("Tk8wD3fRm6Qa");
    expect(await screen.findByText("Your own pace")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Graphics and Motion Design Brief" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 3);
    expect(screen.getByText(/^Task 1: Static Graphic \(Awareness Flyer\)/)).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.getByText("Due")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload a File" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Paste a Link" }));
    const link = await screen.findByRole("textbox");
    fireEvent.change(link, { target: { value: "drive.google.com/file/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    expect(await screen.findByText("A link starting https")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Question 1 of 3" })).toBeTruthy();
    fireEvent.change(link, { target: { value: "https://drive.google.com/file/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(2, 3);
  });

  it("a finished sitting says so, and one whose time ran out says the time is up", async () => {
    const { unmount } = draw("Jd5sF7aWc3Xe");
    expect(await screen.findByRole("heading", { name: "Assessment Submitted" })).toBeTruthy();
    unmount();
    draw("Mz4pK7tYb2Vn");
    expect(await screen.findByRole("heading", { name: "The Time Is Up" })).toBeTruthy();
  });

  it("an unknown link does not open", async () => {
    draw("nope");
    expect(await screen.findByRole("heading", { name: "This link does not open" })).toBeTruthy();
  });

  it("has no accessibility violations, running", async () => {
    /* The brief started above, and is still running: the mock keeps its sittings across a file. */
    const { container } = draw("Tk8wD3fRm6Qa");
    await question(2, 3);
    expect(await axe(container)).toHaveNoViolations();
  });
});
