import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { Pill, StatusPill } from "./Pill";

describe("Pill", () => {
  it("draws the words with a decorative dot in its tone", () => {
    render(<Pill tone="ok">Approved</Pill>);
    const pill = screen.getByText("Approved").parentElement!;
    expect(pill).toHaveAttribute("data-tone", "ok");
    expect(pill).toHaveAttribute("data-copy", "content");
    expect(pill.className).toContain("bg-success-soft");
    expect(pill.querySelector("[aria-hidden=true]")).not.toBeNull();
  });

  it("is neutral by default and can drop the dot", () => {
    render(<Pill dot={false}>Annual Leave</Pill>);
    const pill = screen.getByText("Annual Leave").parentElement!;
    expect(pill).toHaveAttribute("data-tone", "neutral");
    expect(pill.querySelector("[aria-hidden=true]")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <p>
        <Pill tone="ok">Approved</Pill> <Pill tone="warn">Pending</Pill> <Pill tone="err">Declined</Pill> <Pill tone="info">Draft</Pill> <Pill>Closed</Pill>
      </p>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("StatusPill", () => {
  it("draws a status record, by the new and the merged prop, and nothing for none", () => {
    const { container, rerender } = render(<StatusPill status={{ tone: "warn", text: "Awaiting Manager" }} />);
    expect(screen.getByText("Awaiting Manager").parentElement).toHaveAttribute("data-tone", "warn");
    rerender(<StatusPill s={{ tone: "ok", text: "Paid" }} />);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    rerender(<StatusPill s={null} />);
    expect(container.innerHTML).toBe("");
  });
});
