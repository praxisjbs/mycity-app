import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { StageSwitcher } from "./StageSwitcher";

const STAGES = [
  { code: "prospect_identified", label: "Prospect Identified" },
  { code: "initial_contact", label: "Initial Contact" },
  { code: "proposal_sent", label: "Proposal Sent" },
  { code: "partnership_signed", label: "Partnership Signed" },
];

function Deal({ onMove }: { onMove?: (code: string) => unknown }) {
  const [stage, setStage] = useState("initial_contact");
  return (
    <StageSwitcher
      stages={STAGES}
      value={stage}
      onMove={(code) => {
        const out = onMove?.(code);
        setStage(code);
        return out;
      }}
    />
  );
}

describe("StageSwitcher", () => {
  it("marks the current stage and names every other as a move", () => {
    render(<Deal />);
    expect(screen.getByRole("group", { name: "Stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Initial Contact, current stage" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: "Move to Proposal Sent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to Prospect Identified" })).toBeInTheDocument();
  });

  it("moves with one press; pressing the current stage does nothing", async () => {
    const onMove = vi.fn();
    render(<Deal onMove={onMove} />);
    await userEvent.click(screen.getByRole("button", { name: "Initial Contact, current stage" }));
    expect(onMove).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Move to Proposal Sent" }));
    expect(onMove).toHaveBeenCalledWith("proposal_sent");
    expect(screen.getByRole("button", { name: "Proposal Sent, current stage" })).toBeInTheDocument();
  });

  it("refuses a second press while a move runs, and the other stages wait", async () => {
    let finish = () => {};
    const onMove = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    render(<StageSwitcher stages={STAGES} value="initial_contact" onMove={onMove} />);
    const next = screen.getByRole("button", { name: "Move to Proposal Sent" });
    await userEvent.click(next);
    await userEvent.click(next);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(next).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Move to Partnership Signed" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Move to Partnership Signed" }));
    expect(onMove).toHaveBeenCalledTimes(1);
    finish();
  });

  it("read only shows the stages and moves nothing", async () => {
    const onMove = vi.fn();
    render(<StageSwitcher stages={STAGES} value="proposal_sent" onMove={onMove} readOnly />);
    await userEvent.click(screen.getByRole("button", { name: "Move to Initial Contact" }));
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves focus between stages with the arrow keys", async () => {
    render(<Deal />);
    screen.getByRole("button", { name: "Initial Contact, current stage" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Move to Proposal Sent" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("button", { name: "Move to Prospect Identified" })).toHaveFocus();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Deal />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
