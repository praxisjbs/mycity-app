import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { FileCard, fileTypeOf } from "./FileCard";

describe("FileCard", () => {
  it("names the file and says its pages, type and size", () => {
    render(<FileCard name="Call sheet.pdf" mime="application/pdf" sizeBytes={250_000} pages={3} />);
    expect(screen.getByText("Call sheet.pdf")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText(/^3 pages · PDF · /)).toBeInTheDocument();
  });

  it("opens the file from the card and saves it from Download", async () => {
    const open = vi.fn();
    const save = vi.fn();
    render(<FileCard name="Budget.xlsx" mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onOpen={open} onDownload={save} />);
    await userEvent.click(screen.getByRole("button", { name: "Open Budget.xlsx, Excel" }));
    await userEvent.click(screen.getByRole("button", { name: "Download Budget.xlsx" }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("shows a PDF's first page over it, keeping its place while it loads", () => {
    const seen = vi.fn();
    const { container, rerender } = render(<FileCard name="Offer.pdf" mime="application/pdf" hasPreview onSeen={seen} />);
    expect(container.querySelector(".animate-pulse")).not.toBeNull();
    expect(seen).toHaveBeenCalledTimes(1);
    rerender(<FileCard name="Offer.pdf" mime="application/pdf" hasPreview preview="blob:page" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "blob:page");
  });

  it("names a file's type from what the server decided, else its ending", () => {
    expect(fileTypeOf("application/pdf").label).toBe("PDF");
    expect(fileTypeOf("text/csv").glyph).toBe("sheet");
    expect(fileTypeOf("application/octet-stream", "notes.key").label).toBe("KEY");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<FileCard name="Call sheet.pdf" mime="application/pdf" pages={3} hasPreview preview="blob:p" onOpen={() => undefined} onDownload={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
