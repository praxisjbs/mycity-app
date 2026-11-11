import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { HireSteps } from "./HireSteps";

const steps = [
  { title: "Apply", text: "Your CV and a short cover letter, on one form." },
  { title: "Screening", text: "Our team reads every application against the role." },
  { title: "Assessment", text: "A short test or a practical brief, for some roles." },
  { title: "Interview", text: "Meet the panel in person, by video or by phone." },
];

describe("HireSteps", () => {
  it("lists the steps in order, each rising 120 ms after the one before", () => {
    render(<HireSteps label="How We Hire" steps={steps} />);
    const list = screen.getByRole("list", { name: "How We Hire" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[3]!.getAttribute("style")).toContain("360ms");
    expect(within(items[1]!).getByRole("heading", { level: 3, name: "Screening" })).toBeInTheDocument();
    expect(screen.getByText("Meet the panel in person, by video or by phone.")).toBeInTheDocument();
  });

  it("draws the compact tiles for a role's page, numbered", () => {
    render(<HireSteps compact label="How We Hire" steps={[{ title: "Apply" }, { title: "Screening" }, { title: "Interview" }]} />);
    const items = within(screen.getByRole("list", { name: "How We Hire" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["1Apply", "2Screening", "3Interview"]);
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <main>
        <h2>Four Steps, Every Time</h2>
        <HireSteps label="How We Hire" steps={steps} />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
