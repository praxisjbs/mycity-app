// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import appearance from "@mycity/contract/schemas/appearance.js";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";
import { appearanceView } from "@/api/mock/data/appearance";

/**
 * Settings · Appearance (docs/guides/foundation.md §6.15, §10): a preset fills the four colours
 * and the preview at once, a colour that cannot carry the palette is marked on its field before
 * anything is sent, Save Palette sends the four colours and repaints this screen from /me, and a
 * reader without `settings` edit sees it all with nothing to change.
 */

const m = vi.hoisted(() => ({ run: vi.fn(async (_req: unknown) => ({})), canEdit: true, refreshMe: vi.fn(async () => undefined) }));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: appearanceView(), error: null, reload: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
}));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: (_m: string, action = "view") => action === "view" || m.canEdit, refreshMe: m.refreshMe }) }));
vi.mock("@/auth/FreshSignIn", () => ({ useFreshSignIn: () => ({ guard: (run: () => Promise<unknown>) => run(), ensure: async () => true }) }));

import { AppearanceTab } from "./Appearance";

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  m.canEdit = true;
});

const charcoal = appearance.DARK_PRESETS.find((p) => p.key === "charcoal")!.seeds;
const show = () =>
  render(
    <ModalProvider>
      <AppearanceTab />
      <Toaster />
    </ModalProvider>,
  );

describe("Settings · Appearance", () => {
  it("opens on MyCity's own dark theme: the four colours, the presets and the preview", () => {
    show();
    expect((screen.getByLabelText("Background") as HTMLInputElement).value).toBe(appearance.DEFAULT_DARK.background);
    expect((screen.getByLabelText("Primary Yellow") as HTMLInputElement).value).toBe(appearance.DEFAULT_DARK.primary_yellow);
    expect(screen.getByRole("button", { name: "Deep Green" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img", { name: "Preview, Deep Green" })).toBeTruthy();
    expect(screen.getByText("Lowest Contrast")).toBeTruthy();
  });

  it("fills the four colours from a preset, previews it, and Save Palette sends it and repaints from /me", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("button", { name: "Charcoal" }));
    expect((screen.getByLabelText("Card") as HTMLInputElement).value).toBe(charcoal.card);
    expect(screen.getByRole("img", { name: "Preview, Charcoal" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save Palette" }));
    await waitFor(() => expect(m.run).toHaveBeenCalledWith({ body: { dark: charcoal } }));
    expect(m.refreshMe).toHaveBeenCalled();
    expect(await screen.findByText("Dark palette saved")).toBeTruthy();
  });

  it("marks a background too light for the dark theme on its field, and sends nothing", async () => {
    const user = userEvent.setup();
    show();
    const field = screen.getByLabelText("Background");
    await user.clear(field);
    await user.type(field, "F4F4F4");
    await user.click(screen.getByRole("button", { name: "Save Palette" }));
    expect(await screen.findByText("Too light for dark")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom" })).toBeTruthy();
    expect(m.run).not.toHaveBeenCalled();
  });

  it("saves the theme everyone starts on the moment it is picked", async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole("radio", { name: "Dark" }));
    await waitFor(() => expect(m.run).toHaveBeenCalledWith({ body: { theme_default: "dark" } }));
  });

  it("shows a reader without settings edit everything, with nothing to change", () => {
    m.canEdit = false;
    show();
    expect((screen.getByLabelText("Background") as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save Palette" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save Fonts" })).toBeNull();
  });
});
