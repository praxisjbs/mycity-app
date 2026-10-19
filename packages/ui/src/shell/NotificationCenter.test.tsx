import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "../testing/axe";
import { setViewport } from "../testing/viewport";
import { installOverlayTestEnv } from "../overlay/test-env";
import { IconButton } from "../actions/Button";
import { NotificationCenter, type NotificationCenterProps, type NotificationItem } from "./NotificationCenter";

beforeAll(installOverlayTestEnv);
afterEach(() => setViewport(1440));

const NOW = new Date("2026-10-19T09:30:00+01:00");
const ITEMS: NotificationItem[] = [
  { id: "1", title: "Tom-Blake Asaah", body: "Re: Confirm attachments work", at: "2026-10-19T05:33:00+01:00", unread: true, avatar: "Tom-Blake Asaah" },
  { id: "2", title: "New sign-in to your account", body: "Edge on Windows", at: "2026-10-18T19:10:00+01:00", unread: false, icon: "lock" },
  { id: "3", title: "Approval needed: Leave request", at: "2026-10-12T10:00:00+01:00", unread: true, icon: "check" },
];

function setup(over: Partial<NotificationCenterProps> = {}) {
  const props: NotificationCenterProps = {
    open: true,
    onOpenChange: vi.fn(),
    trigger: <IconButton icon="bell" label="Notifications" />,
    view: "all",
    onView: vi.fn(),
    unread: 2,
    items: ITEMS,
    now: NOW,
    onOpenItem: vi.fn(),
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onSettings: vi.fn(),
    ...over,
  };
  render(<NotificationCenter {...props} />);
  return props;
}

describe("NotificationCenter", () => {
  it("on desktop, a panel under the bell with the rows grouped Today, Yesterday and Earlier", async () => {
    setup();
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(within(panel).getByRole("region", { name: "Today" })).toHaveTextContent("Tom-Blake Asaah");
    expect(within(panel).getByRole("region", { name: "Yesterday" })).toHaveTextContent("New sign-in to your account");
    expect(within(panel).getByRole("region", { name: "Earlier" })).toHaveTextContent("Approval needed");
  });

  it("opens a row, marks all read, opens the settings and switches to Unread", async () => {
    const p = setup();
    await userEvent.click(await screen.findByRole("button", { name: /Tom-Blake Asaah/ }));
    expect(p.onOpenItem).toHaveBeenCalledWith(ITEMS[0]);
    await userEvent.click(screen.getByRole("button", { name: "Mark All Read" }));
    expect(p.onMarkAllRead).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Notification Settings" }));
    expect(p.onSettings).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("radio", { name: /Unread/ }));
    expect(p.onView).toHaveBeenCalledWith("unread");
  });

  it("says All Caught Up when nothing is unread", async () => {
    setup({ view: "unread", items: [], unread: 0 });
    expect(await screen.findByText("All Caught Up")).toBeInTheDocument();
  });

  it("on a phone, a full page with Back", async () => {
    setViewport(390);
    const p = setup();
    const page = await screen.findByRole("dialog", { name: "Notifications" });
    expect(page).toHaveTextContent("Tom-Blake Asaah");
    await userEvent.click(within(page).getByRole("button", { name: "Back" }));
    expect(p.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("has no accessibility violations", async () => {
    setup();
    expect(await axe(await screen.findByRole("dialog", { name: "Notifications" }))).toHaveNoViolations();
  });
});
