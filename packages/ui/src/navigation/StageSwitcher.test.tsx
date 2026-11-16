import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { StageSwitcher } from "./StageSwitcher";

const STEPS = [
  { code: "prospect", label: "Prospect" },
  { code: "contacted", label: "Contacted" },
  { code: "proposal", label: "Proposal" },
  { code: "signed", label: "Signed" },
];

const STAGES = [
  {
    code: "prospect_identified",
    label: "Prospect Identified",
    step: "prospect",
  },
  { code: "initial_contact", label: "Initial Contact", step: "contacted" },
  { code: "follow_up", label: "Follow-up Ongoing", step: "contacted" },
  { code: "proposal_sent", label: "Proposal Sent", step: "proposal" },
  { code: "partnership_signed", label: "Partnership Signed", step: "signed" },
  { code: "on_hold", label: "On Hold", step: null },
];

const NEXT: Record<string, string | null> = {
  prospect_identified: "initial_contact",
  initial_contact: "follow_up",
  follow_up: "proposal_sent",
  proposal_sent: "partnership_signed",
  partnership_signed: null,
  on_hold: null,
};

function Deal({ onMove, from = "initial_contact" }: { onMove?: (code: string) => unknown; from?: string }) {
  const [stage, setStage] = useState(from);
  return (
    <StageSwitcher
      label="Stage of Drive-Time"
      steps={STEPS}
      stages={STAGES}
      value={stage}
      next={NEXT[stage]}
      onMove={(code) => {
        const out = onMove?.(code);
        setStage(code);
        return out;
      }}
    />
  );
}

describe("StageSwitcher", () => {
  it("names the stage and marks its step on the bar", () => {
    render(<Deal />);
    const region = screen.getByRole("region", { name: "Stage of Drive-Time" });
    expect(within(region).getByText("Initial Contact")).toBeInTheDocument();
    const steps = within(region).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).toHaveTextContent("done");
    expect(steps[2]).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Next: Follow-up Ongoing")).toBeInTheDocument();
  });

  it("moves to the next stage with one press", async () => {
    const onMove = vi.fn();
    render(<Deal onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Move to Follow-up Ongoing" }));
    expect(onMove).toHaveBeenCalledWith("follow_up");
    expect(screen.getByRole("button", { name: "Move to Proposal Sent" })).toBeInTheDocument();
  });

  it("Change Stage lists every stage, the current one not choosable", async () => {
    const onMove = vi.fn();
    render(<Deal onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Change Stage" }));
    expect(screen.getByRole("menuitem", { name: "Initial Contact" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("menuitem", { name: "On Hold" }));
    expect(onMove).toHaveBeenCalledWith("on_hold");
  });

  it("a stage outside the steps marks no step and offers no Next Stage", () => {
    render(<Deal from="on_hold" />);
    expect(screen.getAllByRole("listitem").some((li) => li.getAttribute("aria-current"))).toBe(false);
    expect(screen.queryByRole("button", { name: /^Move to/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Change Stage" })).toBeInTheDocument();
  });

  it("refuses a second press while a move runs", async () => {
    let finish = () => {};
    const onMove = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<StageSwitcher steps={STEPS} stages={STAGES} value="initial_contact" next="follow_up" onMove={onMove} />);
    const next = screen.getByRole("button", {
      name: "Move to Follow-up Ongoing",
    });
    await userEvent.click(next);
    await userEvent.click(next);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(next).toHaveAttribute("aria-busy", "true");
    finish();
  });

  it("read only shows the stage and moves nothing", () => {
    render(<StageSwitcher steps={STEPS} stages={STAGES} value="proposal_sent" next="partnership_signed" onMove={vi.fn()} readOnly />);
    expect(screen.getByText("Proposal Sent")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Deal />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
