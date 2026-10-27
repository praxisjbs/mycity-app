import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { FormatButton } from "./FormatButton";

const name = (f: string) => `Export ${f.toUpperCase()}`;

describe("FormatButton", () => {
  it("presses straight to its one format", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<FormatButton label="Run Now" formats={["xlsx"]} onRun={onRun} item={name} />);
    await userEvent.click(screen.getByRole("button", { name: "Run Now" }));
    expect(onRun).toHaveBeenCalledWith("xlsx");
  });

  it("offers each format when there are two, and makes the one chosen", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(<FormatButton label="Export" formats={["pdf", "xlsx"]} onRun={onRun} item={name} />);
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Export XLSX" }));
    expect(onRun).toHaveBeenCalledWith("xlsx");
  });

  it("stays busy until the file is made, and a second press makes nothing", async () => {
    let done: () => void = () => undefined;
    const onRun = vi.fn(() => new Promise<void>((resolve) => (done = resolve)));
    render(<FormatButton label="Export" formats={["pdf"]} onRun={onRun} item={name} />);
    const button = screen.getByRole("button", { name: "Export" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).toBe("true");
    done();
    await waitFor(() => expect(button.getAttribute("aria-busy")).not.toBe("true"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<FormatButton label="Export" formats={["pdf", "xlsx"]} onRun={() => Promise.resolve()} item={name} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
