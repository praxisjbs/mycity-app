import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { PdfViewer } from "./PdfViewer";

/* PDF.js does not run in jsdom: the drawing chunk is a stand-in that says what it was given. */
vi.mock("./PdfViewer.draw", () => ({
  default: ({ name, data, tone }: { name: string; data: Blob; tone: string }) => (
    <div role="document" aria-label={name} data-bytes={data.size} data-tone={tone} tabIndex={0}>
      Pages
    </div>
  ),
}));

describe("PdfViewer", () => {
  it("says it is opening the file until its bytes arrive", () => {
    render(<PdfViewer data={null} name="Call sheet.pdf" />);
    expect(screen.getByRole("status", { name: "Opening Call sheet.pdf" })).toBeInTheDocument();
  });

  it("hands the bytes to the drawing, which loads as its own chunk", async () => {
    render(<PdfViewer data={new Blob(["%PDF-1.4 test"])} name="Call sheet.pdf" tone="deep" />);
    const doc = await screen.findByRole("document", { name: "Call sheet.pdf" });
    expect(doc).toHaveAttribute("data-bytes", "13");
    expect(doc).toHaveAttribute("data-tone", "deep");
  });

  it("is as tall as it is told, or fills its parent", () => {
    const { container, rerender } = render(<PdfViewer data={null} name="A.pdf" height="sm" />);
    expect(container.firstElementChild?.className).toContain("h-64");
    rerender(<PdfViewer data={null} name="A.pdf" height="fill" />);
    expect(container.firstElementChild?.className).toContain("h-full");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<PdfViewer data={new Blob(["%PDF"])} name="Call sheet.pdf" />);
    await screen.findByRole("document");
    expect(await axe(container)).toHaveNoViolations();
  });
});
