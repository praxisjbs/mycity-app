// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationRule } from "@mycity/contract/contract.gen.ts";
import { ModalProvider } from "@mycity/ui";

const m = vi.hoisted(() => ({
  run: vi.fn(async () => ({})),
  invalidate: vi.fn(),
  rules: [] as unknown[],
}));
vi.mock("@/api/hooks", () => ({
  invalidate: m.invalidate,
  useApi: () => ({ data: undefined, error: null, reload: () => undefined, set: () => undefined }),
  useMutation: () => ({ run: m.run, pending: false }),
  usePaged: () => ({ rows: m.rules, page: { number: 1, size: 25, total: m.rules.length, pages: 1, has_next: false }, loading: false, error: null, q: "", setQ: () => undefined, setPage: () => undefined }),
}));
vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/features/shared/pickers", () => ({ RolePicker: () => <div>Role Picker</div>, ColleaguePicker: () => <div>People Picker</div> }));

import { NotificationsTab } from "./Notifications";

const rule = (over: Partial<NotificationRule> = {}): NotificationRule => ({
  event_key: "employee.bank_details_changed",
  name: "An employee changed their own bank details",
  category: "people",
  category_label: "Attendance and Leave",
  who: ["People · Edit"],
  locked: false,
  copies: true,
  enabled: true,
  urgency: "normal",
  urgency_default: "normal",
  channels: { in_app: true, email: false, push: true },
  defaults: { in_app: true, email: false, push: true },
  roles: [],
  people: [],
  changed: false,
  updated_at: null,
  ...over,
});

describe("Settings · Notifications", () => {
  beforeAll(() => {
    // jsdom has no matchMedia; the shells' pieces ask it whether this is a phone.
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists each notice with who it goes to, its channels and its level", () => {
    m.rules = [rule(), rule({ event_key: "role.created", name: "A role was created", category: "security", locked: true, copies: false, who: ["CEO", "Settings editors"], urgency: "urgent", urgency_default: "urgent" })];
    render(<ModalProvider><NotificationsTab /></ModalProvider>);
    expect(screen.getAllByText("An employee changed their own bank details").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CEO, Settings editors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Always On").length).toBeGreaterThan(0);
    expect(screen.getAllByText("In App, Push").length).toBeGreaterThan(0);
  });

  it("Edit Notice saves the whole rule for that notice", async () => {
    m.rules = [rule()];
    render(<ModalProvider><NotificationsTab /></ModalProvider>);
    await userEvent.click(screen.getAllByText("An employee changed their own bank details")[0]);
    await userEvent.click(await screen.findByRole("switch", { name: "Email" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Notice" }));
    expect(m.run).toHaveBeenCalledWith({
      params: { key: "employee.bank_details_changed" },
      body: { enabled: true, urgency: "normal", in_app: true, email: true, push: true, role_codes: [], employee_ids: [] },
    });
    expect(m.invalidate).toHaveBeenCalledWith("/api/v1/notifications/rules");
  });

  it("a personal notice offers no copies; Security has no level to choose and stays on", async () => {
    m.rules = [rule({ event_key: "auth.password_changed", name: "A password was changed", category: "security", locked: true, copies: false, who: ["The account holder"] })];
    render(<ModalProvider><NotificationsTab /></ModalProvider>);
    await userEvent.click(screen.getAllByText("A password was changed")[0]);
    await screen.findByRole("button", { name: "Save Notice" });
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText("Role Picker")).toBeNull();
    expect(dialog.queryByText("Level")).toBeNull();
    expect(screen.getByRole("switch", { name: "Always On" }).hasAttribute("disabled")).toBe(true);
  });
});
