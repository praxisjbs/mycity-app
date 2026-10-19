// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";
import { saveBlob } from "./download";

installMatchMedia();

const file = () => new Blob(["When,Who\n"], { type: "text/csv" });

/** An iPhone or iPad app opened from the home screen, whose share sheet answers with `share`. */
function homeScreenApple(share: () => Promise<void>) {
  const shared = vi.fn(share);
  Object.defineProperty(navigator, "standalone", { value: true, configurable: true });
  Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
  Object.defineProperty(navigator, "share", { value: shared, configurable: true });
  return shared;
}

let clicked: HTMLAnchorElement[] = [];

beforeEach(() => {
  clicked = [];
  URL.createObjectURL = vi.fn(() => "blob:export");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this);
  });
});

afterEach(() => {
  cleanup();
  for (const key of ["standalone", "canShare", "share"]) Reflect.deleteProperty(navigator, key);
  vi.restoreAllMocks();
});

describe("saveBlob", () => {
  it("hands a computer or an Android phone the browser's own download, under the file's name", async () => {
    expect(await saveBlob(file(), "audit-log-2026-10-19.xlsx")).toBe(true);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("audit-log-2026-10-19.xlsx");
    expect(clicked[0].href).toBe("blob:export");
  });

  it("opens the share sheet with the file on an iPhone app from the home screen, which cannot download", async () => {
    const shared = homeScreenApple(() => Promise.resolve());
    expect(await saveBlob(file(), "my-data-00003-2026-10-19.xlsx")).toBe(true);
    expect(shared).toHaveBeenCalledTimes(1);
    const [{ files }] = shared.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files.map((f) => f.name)).toEqual(["my-data-00003-2026-10-19.xlsx"]);
    expect(clicked).toHaveLength(0);
  });

  it("saves nothing, and says nothing, when the person closes the share sheet", async () => {
    homeScreenApple(() => Promise.reject(new DOMException("closed", "AbortError")));
    render(createElement(Toaster));
    expect(await saveBlob(file(), "Organogram.pdf")).toBe(false);
    expect(screen.queryByText("Your file is ready")).toBeNull();
  });

  it("offers Save File when the press is too long ago for the share sheet, and one tap opens it", async () => {
    const shared = homeScreenApple(() => Promise.resolve());
    shared.mockRejectedValueOnce(new DOMException("no user activation", "NotAllowedError"));
    render(createElement(Toaster));
    expect(await saveBlob(file(), "Organogram.pdf")).toBe(false);
    expect(await screen.findByText("Your file is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save File" }));
    await waitFor(() => expect(shared).toHaveBeenCalledTimes(2));
    expect(clicked).toHaveLength(0);
  });
});
