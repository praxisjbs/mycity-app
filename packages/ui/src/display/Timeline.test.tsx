import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Timeline } from "./Timeline";

const ITEMS = [
  { title: "Submitted by Ada Obi", when: "13/10/2026 09:41", tone: "done" as const },
  { title: "Approved by Chidi Eze", when: "13/10/2026 11:02", text: "Within policy", tone: "done" as const },
  { title: "Waiting on Finance", when: "13/10/2026 11:03", tone: "now" as const },
];

describe("Timeline", () => {
  it("reads as an ordered, named list of events", () => {
    render(<Timeline items={ITEMS} label="Claim History" />);
    const list = screen.getByRole("list", { name: "Claim History" });
    expect(list.tagName).toBe("OL");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("draws each event's words, time and extra line", () => {
    render(<Timeline items={ITEMS} />);
    expect(screen.getByText("Submitted by Ada Obi")).toBeInTheDocument();
    expect(screen.getByText("13/10/2026 11:02")).toBeInTheDocument();
    expect(screen.getByText("Within policy")).toBeInTheDocument();
  });

  it("marks the step in hand and the ones behind it", () => {
    render(<Timeline items={ITEMS} />);
    const now = screen.getByText("Waiting on Finance").closest("li")!;
    const done = screen.getByText("Submitted by Ada Obi").closest("li")!;
    expect(now.className).toContain("timeline-dot-now");
    expect(done.className).toContain("timeline-dot-done");
  });

  it("is marked as content, since the events are what the record says", () => {
    render(<Timeline items={ITEMS} />);
    expect(screen.getByRole("list")).toHaveAttribute("data-copy", "content");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Timeline items={ITEMS} label="Claim History" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
