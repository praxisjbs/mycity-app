import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "../testing/axe";
import { DocumentPreview } from "./DocumentPreview";

/* PDF.js does not run in jsdom: the drawing chunk is a stand-in that says what it was given. */
vi.mock("./PdfViewer.draw", () => ({
  default: ({ name, data }: { name: string; data: Blob }) => (
    <div role="document" aria-label={name} data-bytes={data.size}>
      Pages
    </div>
  ),
}));

const HREF = "/api/v1/documents/d1/file";

describe("DocumentPreview", () => {
  it("names the file, says how big it is, and offers Open in Tab", () => {
    render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} sizeBytes={2048} />);
    expect(screen.getByText("Receipt.pdf")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open in Tab" });
    expect(open).toHaveAttribute("href", HREF);
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("draws a PDF's pages in the app from its bytes, never in an <object>", async () => {
    const file = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const { container } = render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} file={file} />);
    expect(await screen.findByRole("document", { name: "Receipt.pdf" })).toHaveAttribute("data-bytes", "8");
    expect(container.querySelector("object")).toBeNull();
  });

  it("says it is opening a PDF whose bytes are still on their way", () => {
    render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} />);
    expect(screen.getByRole("status", { name: "Opening Receipt.pdf" })).toBeInTheDocument();
  });

  it("sends a picture to the image viewer", () => {
    render(<DocumentPreview name="Receipt.jpg" mime="image/jpeg" href={HREF} />);
    expect(screen.getByRole("img", { name: "Receipt.jpg" })).toHaveAttribute("src", HREF);
    expect(screen.getByRole("button", { name: "Zoom In" })).toBeInTheDocument();
  });

  it("offers a download for anything it cannot draw", () => {
    render(<DocumentPreview name="Staff.xlsx" mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" href={HREF} />);
    expect(screen.getByText("Download To Read")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("carries the screen's own actions beside Open in Tab", () => {
    render(
      <DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} actions={<button type="button">Remove File</button>} />,
    );
    expect(screen.getByRole("button", { name: "Remove File" })).toBeInTheDocument();
  });

  it("has no accessibility violations, as a PDF, a picture and a download", async () => {
    const pdf = render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} sizeBytes={2048} />);
    expect(await axe(pdf.container)).toHaveNoViolations();
    pdf.unmount();
    const image = render(<DocumentPreview name="Receipt.jpg" mime="image/jpeg" href={HREF} />);
    expect(await axe(image.container)).toHaveNoViolations();
    image.unmount();
    const other = render(<DocumentPreview name="Staff.xlsx" mime="application/zip" href={HREF} />);
    expect(await axe(other.container)).toHaveNoViolations();
  });
});
