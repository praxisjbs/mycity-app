import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ResultLine } from "./ResultLine";

const lines = [
  { type: "leave_request", id: "l1", label: "Ayo Bello, Annual Leave, 3 days", ok: true, message: "approved", link: "/people?tab=leave&id=l1" },
  { type: "leave_request", id: "l2", label: "Kemi Ade, Annual Leave, 2 days", ok: false, message: "This request was already decided", link: "/people?tab=leave&id=l2" },
];

describe("ResultLine", () => {
  it("says Done, lists each record with its outcome, and Open goes to the record", async () => {
    const onOpen = vi.fn();
    render(<ResultLine result={{ status: "done", lines, message: null, error_code: null }} onOpen={onOpen} />);
    expect(screen.getByRole("status").textContent).toBe("Done");
    expect(screen.getByRole("listitem", { name: "Ayo Bello, Annual Leave, 3 days, done" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Kemi Ade, Annual Leave, 2 days, not done" }).textContent).toContain("This request was already decided");
    const opens = screen.getAllByRole("button", { name: "Open" });
    await userEvent.click(opens[1]!);
    expect(onOpen).toHaveBeenCalledWith("/people?tab=leave&id=l2");
  });

  it("says why a press could not finish, in the service's words, as content", () => {
    render(<ResultLine result={{ status: "failed", lines: [], message: "the service fell over", error_code: "AI_ACTION_FAILED" }} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Could Not Finishthe service fell over");
    expect(status.querySelector('[data-copy="content"]')!.textContent).toBe("the service fell over");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ResultLine result={{ status: "done", lines, message: null, error_code: null }} onOpen={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
