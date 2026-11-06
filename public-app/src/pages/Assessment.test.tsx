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

const question = (n: number, of: number) => screen.findByText(`Question ${n} of ${of}`);
const aside = () => screen.getByRole("complementary", { name: "Assessment" });

describe("Assessment", () => {
  it("opens on its intro, and Start the Assessment puts the first question under the clock", async () => {
    draw("Px2mL9vQe4Ty");
    expect(await screen.findByText("Sales Scenario Case Study.")).toBeTruthy();
    expect(within(aside()).getByText("Head, Sales & Revenue")).toBeTruthy();
    expect(within(aside()).getByText(/^Hello Ngozi\. Start by \d{2}\/\d{2}\/\d{4}\. Every answer saves as you type\.$/)).toBeTruthy();
    const intro = screen.getByRole("region", { name: "The Assessment" });
    for (const [k, v] of [["Type", "Case Study"], ["Time", "60 minutes"], ["Questions", "3"]]) expect(within(intro).getByText(k).nextElementSibling?.textContent).toBe(v);
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 3);
    /* The clock is a ring in the aside, with the questions under it; the greeting is gone. */
    expect(within(aside()).getByRole("timer").getAttribute("aria-label")).toMatch(/^Time Left: (59|60) minutes$/);
    expect(within(aside()).getByRole("button", { name: "Question 1" }).getAttribute("aria-current")).toBe("step");
    expect(within(aside()).queryByText(/^Hello Ngozi/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: /^A chain of five Lagos restaurants/ })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await question(2, 3);
    expect(screen.getByRole("radio", { name: "Disagree" }).getAttribute("aria-checked")).toBe("true");
    /* The map moves too, and marks what is answered. */
    fireEvent.click(within(aside()).getByRole("button", { name: "Question 3" }));
    await question(3, 3);
    expect(within(aside()).getByRole("button", { name: "Question 1, answered" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit Assessment" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Submit Assessment" });
    expect(within(dialog).getByText("You answered 2 of 3 questions. Answers cannot change after this.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Assessment" }));
    expect(await screen.findByRole("heading", { name: "Assessment Submitted" })).toBeTruthy();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("a take-home brief has a due day, no clock, and takes a file or a link", async () => {
    draw("Tk8wD3fRm6Qa");
    expect(await screen.findByText("Your own pace")).toBeTruthy();
    expect(within(aside()).getByText("Graphics and Motion Design Brief.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 3);
    expect(screen.getByText(/^Task 1: Static Graphic \(Awareness Flyer\)/)).toBeTruthy();
    expect(screen.queryByRole("timer")).toBeNull();
    expect(within(aside()).getByText(/^Due \d{2}\/\d{2}\/\d{4}, 23:59\.$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a File PDF, Office, image or video" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Paste a Link" }));
    const link = await screen.findByRole("textbox");
    fireEvent.change(link, { target: { value: "drive.google.com/file/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("A link starting https")).toBeTruthy();
    expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    fireEvent.change(link, { target: { value: "https://drive.google.com/file/abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await question(2, 3);
  });

  it("a finished sitting says so, and one whose time ran out says the time is up", async () => {
    const { unmount } = draw("Jd5sF7aWc3Xe");
    expect(await screen.findByRole("heading", { name: "Assessment Submitted" })).toBeTruthy();
    expect(screen.getByText(/^Your answers reached the hiring team at \d{2}:\d{2}\.$/)).toBeTruthy();
    unmount();
    draw("Mz4pK7tYb2Vn");
    expect(await screen.findByRole("heading", { name: "The Time Is Up" })).toBeTruthy();
  });

  it("an unknown link does not open", async () => {
    draw("nope");
    expect(await screen.findByRole("heading", { name: "This Link Does Not Open" })).toBeTruthy();
  });

  it("has no accessibility violations, running", async () => {
    /* The brief started above, and is still running: the mock keeps its sittings across a file. */
    const { container } = draw("Tk8wD3fRm6Qa");
    await question(2, 3);
    expect(await axe(container)).toHaveNoViolations();
  });
});
