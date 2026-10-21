// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NumberingScheme } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia } from "@mycity/ui/testing";

/**
 * Settings · Documents & Numbering (docs/guides/foundation.md §10): a scheme's rules are met as it
 * is filled, never on Save (fault #3, 21/10/2026: a yearly scheme without its period was refused
 * by the server), and moving Starts Again off Never ticks Period.
 */

const m = vi.hoisted(() => ({ run: vi.fn(async () => ({})), schemes: [] as unknown[] }));
vi.mock("@/api/hooks", () => ({
  invalidate: vi.fn(),
  useApi: () => ({ data: undefined, error: null, reload: () => undefined, set: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
  usePaged: () => ({ rows: m.schemes, page: { number: 1, size: 25, total: m.schemes.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined }),
}));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: () => true }) }));

import { NumberingTab } from "./Numbering";

const expense: NumberingScheme = {
  doc_type: "expense",
  label: "Expense Request",
  prefix: "EXP",
  padding: 4,
  separator: "-",
  reset: "never",
  include_period: false,
  next: "EXP-0123",
  issued: 122,
  updated_at: "2026-10-20T09:00:00.000Z",
};

installMatchMedia();
// Radix measures its radio and checkbox controls; jsdom has no layout to measure.
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
});

/** Opens the scheme's form from its row. */
async function openScheme(user: ReturnType<typeof userEvent.setup>) {
  m.schemes = [expense];
  render(
    <ModalProvider>
      <NumberingTab />
    </ModalProvider>,
  );
  await user.click(screen.getAllByText("Expense Request")[0]!);
  return screen.findByRole("dialog", { name: "Expense Request" });
}

describe("Settings · Documents & Numbering", () => {
  it("ticks Period when Starts Again moves off Never, and saves the scheme", async () => {
    const user = userEvent.setup();
    const form = await openScheme(user);
    const period = within(form).getByRole("checkbox", { name: "Put the year or month in the number" });
    expect(period.getAttribute("aria-checked")).toBe("false");
    await user.click(within(form).getByRole("radio", { name: "Each Year" }));
    expect(period.getAttribute("aria-checked")).toBe("true");
    await user.click(within(form).getByRole("button", { name: "Save Numbering" }));
    expect(m.run).toHaveBeenCalledWith({ params: { doc_type: "expense" }, body: expect.objectContaining({ reset: "yearly", include_period: true }) });
  });

  it("says a scheme that starts again needs its period as soon as it is unticked, and saves nothing", async () => {
    const user = userEvent.setup();
    const form = await openScheme(user);
    await user.click(within(form).getByRole("radio", { name: "Each Month" }));
    await user.click(within(form).getByRole("checkbox", { name: "Put the year or month in the number" }));
    expect(await within(form).findByText("Needed when it resets")).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: "Save Numbering" }));
    expect(m.run).not.toHaveBeenCalled();
  });

  it("asks for digits when there is no prefix, before Save", async () => {
    const user = userEvent.setup();
    const form = await openScheme(user);
    await user.clear(within(form).getByLabelText("Prefix"));
    const digits = within(form).getByLabelText("Digits");
    await user.clear(digits);
    await user.type(digits, "0");
    await user.tab();
    expect(await within(form).findByText("Add sequence digits")).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: "Save Numbering" }));
    expect(m.run).not.toHaveBeenCalled();
  });
});
