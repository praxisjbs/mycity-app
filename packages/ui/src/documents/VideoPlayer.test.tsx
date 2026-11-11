import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { VideoPlayer, YOUTUBE_EMBED } from "./VideoPlayer";

describe("VideoPlayer", () => {
  it("loads nothing until Play Video is pressed, then plays YouTube from its privacy-enhanced domain", async () => {
    const { container } = render(<VideoPlayer title="Why Data Matters" youtubeId="dQw4w9WgXcQ" />);
    expect(container.querySelector("iframe")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Play Video, Why Data Matters" }));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(`${YOUTUBE_EMBED}dQw4w9WgXcQ?rel=0&autoplay=1`);
    expect(YOUTUBE_EMBED).toBe("https://www.youtube-nocookie.com/embed/");
    expect(frame).toHaveAttribute("aria-label", "Why Data Matters");
    expect(frame).not.toHaveAttribute("title");
  });

  it("never puts an id that is not YouTube's shape in a frame's address", () => {
    render(<VideoPlayer title="Odd Link" youtubeId={'x" onload="alert(1)'} />);
    expect(screen.queryByRole("button", { name: /Play Video/ })).toBeNull();
    expect(screen.getByText("No video here")).toBeInTheDocument();
  });

  it("fetches an uploaded video only on Play, and plays it from its bytes", async () => {
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:walkthrough");
    const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let give: (b: Blob) => void = () => undefined;
    const load = vi.fn(() => new Promise<Blob>((r) => (give = r)));
    const { container, unmount } = render(<VideoPlayer title="Platform Walkthrough" load={load} />);
    expect(load).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Play Video/ }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Opening video");
    give(new Blob(["x"], { type: "video/mp4" }));
    await waitFor(() => expect(container.querySelector("video")).toHaveAttribute("src", "blob:walkthrough"));
    expect(container.querySelector("video")).toHaveAttribute("aria-label", "Platform Walkthrough");
    unmount();
    expect(revoked).toHaveBeenCalledWith("blob:walkthrough");
    created.mockRestore();
    revoked.mockRestore();
  });

  it("says so in words when the video does not load, and tries again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("refused")).mockReturnValue(new Promise<Blob>(() => undefined));
    render(<VideoPlayer title="Platform Walkthrough" load={load} />);
    await userEvent.click(screen.getByRole("button", { name: /Play Video/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Video did not load");
    await userEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<VideoPlayer title="Why Data Matters" youtubeId="dQw4w9WgXcQ" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
