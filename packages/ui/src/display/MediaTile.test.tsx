import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { MediaAlbum, MediaTile } from "./MediaTile";

describe("MediaTile", () => {
  it("draws a photo at its own shape, and opens it", async () => {
    const open = vi.fn();
    const { container } = render(<MediaTile src="blob:set" alt="Set.jpg" width={1600} height={1200} onOpen={open} />);
    expect(container.firstElementChild?.getAttribute("style")).toContain("--ratio: 1.3333");
    await userEvent.click(screen.getByRole("button", { name: "Open Set.jpg" }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("crops a very tall photo at 4:5 and a very wide one at 2:1", () => {
    const { container, rerender } = render(<MediaTile src="blob:a" alt="Tall.jpg" width={400} height={2000} />);
    expect(container.firstElementChild?.getAttribute("style")).toContain("--ratio: 0.8");
    rerender(<MediaTile src="blob:a" alt="Wide.jpg" width={4000} height={500} />);
    expect(container.firstElementChild?.getAttribute("style")).toContain("--ratio: 2");
  });

  it("says a video is one, and how long", () => {
    render(<MediaTile src={null} alt="Walkthrough.mp4" kind="video" duration="0:42" />);
    expect(screen.getByRole("button", { name: "Open video Walkthrough.mp4, 0:42" })).toBeInTheDocument();
  });

  it("asks for its picture once it is near the screen", () => {
    const seen = vi.fn();
    render(<MediaTile src={null} alt="Set.jpg" onSeen={seen} />);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("shows a file's glyph and name, and Remove takes it out", async () => {
    const remove = vi.fn();
    render(<MediaTile src={null} alt="Budget.xlsx" kind="file" glyph="sheet" fit="square" onRemove={remove} />);
    expect(screen.getByText("Budget.xlsx")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Budget.xlsx" }));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("MediaAlbum", () => {
  const tiles = Array.from({ length: 7 }, (_, i) => ({ key: `p${i}`, src: `blob:${i}`, alt: `Photo ${i + 1}.jpg` }));

  it("shows four, two by two, the fourth saying how many more", () => {
    render(<MediaAlbum tiles={tiles} />);
    expect(screen.getByRole("group", { name: "7 photos" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Open Photo 4.jpg, and 3 more" })).toHaveTextContent("+3");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<MediaAlbum tiles={tiles.slice(0, 4)} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
