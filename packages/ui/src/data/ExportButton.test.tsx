import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { Toaster } from "../feedback/Toaster";
import { ApiError } from "./createApi";
import { ExportButton } from "./ExportButton";

describe("ExportButton", () => {
  it("makes the file, saves it, and says so", async () => {
    const onExport = vi.fn().mockResolvedValue(true);
    render(
      <>
        <ExportButton onExport={onExport} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onExport).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText("Export downloaded")).toBeInTheDocument());
  });

  it("takes its own label and message", async () => {
    render(
      <>
        <ExportButton onExport={() => Promise.resolve(true)} message="Payslips downloaded">
          Export Payslips
        </ExportButton>
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export Payslips" }));
    await waitFor(() => expect(screen.getByText("Payslips downloaded")).toBeInTheDocument());
  });

  it("says nothing more when nothing was saved, since the person was already told why", async () => {
    render(
      <>
        <ExportButton onExport={() => Promise.resolve(false)} message="Register downloaded" />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-busy")).not.toBe("true"));
    expect(screen.queryByText("Register downloaded")).toBeNull();
  });

  it("says one line when the file could not be made, in the server's words when it gave them, and stays pressable", async () => {
    const onExport = vi
      .fn()
      .mockRejectedValueOnce(new Error("no"))
      .mockRejectedValueOnce(new ApiError(429, { error: { code: "DATA_EXPORT_LIMIT", message: "Try again tomorrow." } }));
    render(
      <>
        <ExportButton onExport={onExport} />
        <Toaster />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(screen.getByText("Export failed. Try again.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(screen.getByText("Try again tomorrow.")).toBeInTheDocument());
  });

  it("stays busy until the file is saved, ignoring a second press", async () => {
    let release: (v: unknown) => void = () => undefined;
    const onExport = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
    render(<ExportButton onExport={onExport} />);
    const button = screen.getByRole("button", { name: "Export" });
    await userEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await userEvent.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
    release(true);
    await waitFor(() => expect(button.getAttribute("aria-busy")).not.toBe("true"));
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ExportButton onExport={() => Promise.resolve(true)} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
