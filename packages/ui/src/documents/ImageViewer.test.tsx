import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { ImageViewer } from "./ImageViewer";

const SRC = "/api/v1/documents/d1/file";

describe("ImageViewer", () => {
  it("shows the picture named by its file, as content", () => {
    render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    const picture = screen.getByRole("img", { name: "Receipt.jpg" });
    expect(picture).toHaveAttribute("src", SRC);
    expect(picture).toHaveAttribute("data-copy", "content");
  });

  it("zooms in and out in steps, announcing where it is", async () => {
    render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    expect(screen.getByText("100%")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("button", { name: "Zoom Out" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Zoom In" }));
    expect(screen.getByText("150%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom Out" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("stops at its largest step", async () => {
    render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    const zoomIn = screen.getByRole("button", { name: "Zoom In" });
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    expect(screen.getByText("300%")).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
  });

  it("puts the zoom in a CSS variable once it is past full size", async () => {
    render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    await userEvent.click(screen.getByRole("button", { name: "Zoom In" }));
    const picture = screen.getByRole("img", { name: "Receipt.jpg" });
    expect(picture.style.getPropertyValue("--zoom")).toBe("150%");
    expect(picture.className).toContain("w-(--zoom)");
  });

  it("opens the picture full size in a new tab, unless the frame already offers it", () => {
    const { rerender } = render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    expect(screen.getByRole("link", { name: "Open Full" })).toHaveAttribute("target", "_blank");
    rerender(<ImageViewer src={SRC} alt="Receipt.jpg" noOpen />);
    expect(screen.queryByRole("link", { name: "Open Full" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ImageViewer src={SRC} alt="Receipt.jpg" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
