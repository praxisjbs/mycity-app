import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Toaster } from "../feedback/Toaster";
import { ExportButton } from "./ExportButton";

describe("ExportButton", () => {
  it("queues the export and says so", async () => {
    const onExport = vi.fn().mockResolvedValue({});
    render(
      <>
        <ExportButton onExport={onExport} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("Export queued")).toBeInTheDocument());
  });

  it("takes its own label and message", async () => {
    render(
      <>
        <ExportButton onExport={() => Promise.resolve({})} message="Payslips queued">
          Export Payslips
        </ExportButton>
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export Payslips" }));
    await waitFor(() => expect(screen.getByText("Payslips queued")).toBeInTheDocument());
  });

  it("says one line when the request fails, and stays pressable", async () => {
    const onExport = vi.fn().mockRejectedValue(new Error("no"));
    render(
      <>
        <ExportButton onExport={onExport} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(screen.getByText("Export could not start")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("ignores a second press while the first is in flight", async () => {
    let release: (v: unknown) => void = () => undefined;
    const onExport = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
    render(<ExportButton onExport={onExport} />);
    const button = screen.getByRole("button", { name: "Export" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
    release({});
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ExportButton onExport={() => Promise.resolve({})} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
