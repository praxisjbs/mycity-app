import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { MediaViewer, type ViewerItem } from "./MediaViewer";

vi.mock("./PdfViewer.draw", () => ({
  default: ({ name }: { name: string }) => (
    <div role="document" aria-label={name} tabIndex={0}>
      Pages
    </div>
  ),
}));

const ITEMS: ViewerItem[] = [
  { key: "a", name: "Stage.jpg", mime: "image/jpeg", by: "Bola Ade", at: "Today, 14:02", caption: "Stage build at nfelia.com", poster: "blob:poster-a" },
  { key: "b", name: "Walkthrough.mp4", mime: "video/mp4", by: "Bola Ade", at: "Today, 14:03" },
  { key: "c", name: "Call sheet.pdf", mime: "application/pdf", by: "Tunde Ola", at: "Today, 14:05" },
  { key: "d", name: "Budget.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
];

let made = 0;
beforeEach(() => {
  made = 0;
  URL.createObjectURL = vi.fn(() => `blob:made-${++made}`);
  URL.revokeObjectURL = vi.fn();
  setViewport(1440);
});
afterEach(() => vi.restoreAllMocks());

const view = (over: Partial<Parameters<typeof MediaViewer>[0]> = {}) => {
  const props = {
    open: true,
    items: ITEMS,
    index: 0,
    onIndex: vi.fn(),
    onClose: vi.fn(),
    load: vi.fn(async (item: ViewerItem) => new Blob([item.name], { type: item.mime })),
    ...over,
  };
  return { props, ...render(<MediaViewer {...props} />) };
};

describe("MediaViewer", () => {
  it("is a dialog named by who sent it, showing the photo at once and then the file itself", async () => {
    const { props } = view();
    expect(screen.getByRole("dialog", { name: "Bola Ade" })).toBeInTheDocument();
    expect(screen.getByText("Stage.jpg · Today, 14:02")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: "Stage.jpg" })).toHaveAttribute("src", "blob:made-1"));
    expect(props.load).toHaveBeenCalledWith(ITEMS[0]);
    expect(screen.getByRole("link", { name: /nfelia\.com/ })).toHaveAttribute("href", "https://nfelia.com/");
  });

  it("steps with the arrows and the keyboard, never past either end", async () => {
    const { props } = view();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(props.onIndex).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard("{ArrowRight}");
    expect(props.onIndex).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard("{ArrowLeft}");
    expect(props.onIndex).toHaveBeenCalledTimes(2);
  });

  it("saves the file it already holds with Download, without fetching it again", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const { props } = view();
    await waitFor(() => expect(screen.getByRole("img", { name: "Stage.jpg" })).toHaveAttribute("src", "blob:made-1"));
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(props.load).toHaveBeenCalledTimes(1);
  });

  it("hands Download to the app's own save when it has one", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const save = vi.fn(async () => true);
    view({ save });
    await waitFor(() => expect(screen.getByRole("img", { name: "Stage.jpg" })).toHaveAttribute("src", "blob:made-1"));
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(save).toHaveBeenCalledWith(expect.any(Blob), "Stage.jpg");
    expect(click).not.toHaveBeenCalled();
  });

  it("offers Forward only where the screen gives it, for the file on view", async () => {
    view();
    expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
    const onForward = vi.fn();
    view({ onForward, index: 2 });
    await userEvent.click(screen.getAllByRole("button", { name: "Forward" })[0]!);
    expect(onForward).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("asks for a file once while it is on its way, however often the screen redraws", async () => {
    let arrive: (b: Blob) => void = () => undefined;
    const load = vi.fn(() => new Promise<Blob>((resolve) => (arrive = resolve)));
    const { props, rerender } = view({ load });
    rerender(<MediaViewer {...props} items={[...ITEMS]} />);
    rerender(<MediaViewer {...props} items={[...ITEMS]} />);
    arrive(new Blob(["x"], { type: "image/jpeg" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Stage.jpg" })).toHaveAttribute("src", "blob:made-1"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("draws a PDF in the app, and offers anything else as a download", async () => {
    view({ index: 2 });
    expect(await screen.findByRole("document", { name: "Call sheet.pdf" })).toBeInTheDocument();
    view({ index: 3 });
    expect(screen.getAllByRole("button", { name: "Download File" }).length).toBeGreaterThan(0);
  });

  it("says when a file cannot be opened, with Download beside it", async () => {
    view({ load: vi.fn(async () => Promise.reject(new Error("gone"))) });
    expect(await screen.findByText("Cannot Open File")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download File" })).toBeInTheDocument();
  });

  it("closes with Close and with Esc", async () => {
    const { props } = view();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("opens with focus on the viewer itself, so the first Esc closes it", async () => {
    const { props } = view();
    expect(screen.getByRole("dialog")).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("offers Share on a phone that can share the file, and the phone's Back closes it", async () => {
    setViewport(390);
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    const { props, unmount } = view();
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(back).not.toHaveBeenCalled();
    delete (navigator as { canShare?: unknown }).canShare;
  });

  it("has no accessibility violations", async () => {
    const { baseElement } = view();
    await waitFor(() => expect(screen.getByRole("img", { name: "Stage.jpg" })).toHaveAttribute("src", "blob:made-1"));
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
