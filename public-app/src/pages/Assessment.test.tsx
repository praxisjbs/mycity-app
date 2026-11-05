// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "@mycity/ui/testing";
import { RouterProvider } from "@/lib/router";
import { Assessment } from "./Assessment";

/**
 * Assessment on the in-browser mock: a timed case study not started, one in progress on its
 * second question, a take-home brief of file answers, one submitted and one whose time ran out.
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
    expect(await screen.findByRole("heading", { level: 1, name: "Partnership Brief" })).toBeTruthy();
    const facts = screen.getByRole("list", { name: "About the Assessment" });
    for (const t of ["Case Study", "45 minutes", "5"]) expect(within(facts).getByText(t)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 5);
    expect(screen.getByRole("timer")).toBeTruthy();
  });

  it("resumes where it was, saves a choice as it is made, and moves between questions", async () => {
    draw("Hb6tZ3qNw8Rk");
    await question(2, 5);
    fireEvent.click(screen.getByRole("radio", { name: "Look at what changed and share it with them, with a plan" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await question(1, 5);
    /* The first answer was already saved, so it shows chosen. */
    expect(screen.getByRole("radio", { name: "A revenue share on bookings made through the app" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(2, 5);
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(3, 5);
    fireEvent.change(screen.getByLabelText("Your Answer"), { target: { value: "A revenue share of 8 percent on bookings, with featured guides." } });
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(4, 5);
    fireEvent.click(screen.getByRole("button", { name: "Next Question" }));
    await question(5, 5);

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Submit Assessment" });
    expect(within(dialog).getByText("You answered 3 of 5 questions. Answers cannot change after this.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit Assessment" }));
    expect(await screen.findByRole("heading", { name: "Assessment Submitted" })).toBeTruthy();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("a take-home brief has a due day, no clock, and takes a file or a link", async () => {
    draw("Tk8wD3fRm6Qa");
    expect(await screen.findByText("Your own pace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the Assessment" }));
    await question(1, 3);
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
