import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "../testing/axe";
import { DocumentPreview } from "./DocumentPreview";

const HREF = "/api/v1/documents/d1/file";

describe("DocumentPreview", () => {
  it("names the file, says how big it is, and offers Open in New Tab", () => {
    render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} sizeBytes={2048} />);
    expect(screen.getByText("Receipt.pdf")).toHaveAttribute("data-copy", "content");
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open in New Tab" });
    expect(open).toHaveAttribute("href", HREF);
    expect(open).toHaveAttribute("target", "_blank");
  });

  it("streams a PDF into the browser's own viewer, named by the file", () => {
    const { container } = render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} />);
    const frame = container.querySelector("object")!;
    expect(frame).toHaveAttribute("type", "application/pdf");
    expect(frame).toHaveAttribute("aria-label", "Receipt.pdf");
    expect(frame).toHaveAttribute("data", HREF);
  });

  it("carries the browser's own fallback inside the frame, so a PDF it will not draw is still reachable", () => {
    const { container } = render(<DocumentPreview name="Receipt.pdf" mime="application/pdf" href={HREF} />);
    const frame = container.querySelector("object")!;
    expect(within(frame).getByText("Cannot Show Here")).toBeInTheDocument();
    expect(within(frame).getByRole("link", { name: "Download File" })).toHaveAttribute("download", "Receipt.pdf");
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

  it("carries the screen's own actions beside Open in New Tab", () => {
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
