import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { RecordPane } from "./RecordPane";

const RECORD = { title: "Ayo Bello", items: [["Days", "3"], ["Starts", "27/10/2026"]] as const, link: "/people?tab=leave&id=l1" };

describe("RecordPane", () => {
  it("shows the record's fields and opens its screen", async () => {
    const onOpen = vi.fn();
    render(<RecordPane record={RECORD} onOpen={onOpen} />);
    expect(screen.getByRole("heading", { name: "Ayo Bello" })).toBeInTheDocument();
    expect(screen.getByText("27/10/2026")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Record" }));
    expect(onOpen).toHaveBeenCalledWith("/people?tab=leave&id=l1");
  });

  it("offers no Open Record for a record with no screen of its own", () => {
    render(<RecordPane record={{ ...RECORD, link: null }} onOpen={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says No Record Open before one is picked", () => {
    render(<RecordPane record={null} />);
    expect(screen.getByRole("heading", { name: "No Record Open" })).toBeInTheDocument();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<RecordPane record={RECORD} onOpen={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
