// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalProvider, Toaster } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import type { Message, Wish } from "@/api/types/community";
import { Post } from "./Posts";
import { cardSeen, markCardSeen } from "./seen";

/**
 * The celebration cards (docs/guides/community.md §3 step 3, §10): Cynthia's birthday and
 * anniversary cards, Celebrate handing back its request, Send Wishes checked on its field
 * before anything is sent, a wish deleted by its author after asking once, and the device
 * remembering which cards a person has seen.
 */

vi.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ me: { user_id: "user-me", employee_id: "emp-me" } }) }));

installMatchMedia();
beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

const person = (id: string, name: string, job: string | null = null, department: string | null = null) => ({ employee_id: id, display_name: name, job_title: job, department, photo_url: null });
const wish = (n: number, name: string, body: string, mine = false): Wish => ({
  community_wish_id: `00000000-0000-4000-9000-00000000000${n}`,
  community_message_id: "00000000-0000-4000-8000-000000000001",
  author: person(`emp-${n}`, name),
  mine,
  body,
  created_at: "2026-10-22T08:10:00.000Z",
  can_delete: mine,
});

function card(type: "birthday" | "anniversary", over: Partial<NonNullable<Message["celebration"]>> = {}): Message {
  return {
    community_message_id: "00000000-0000-4000-8000-000000000001",
    community_channel_id: "11111111-1111-4111-8111-111111111111",
    message_type: type,
    author: null,
    mine: false,
    sent_at: "2026-10-22T07:00:00.000Z",
    body: type === "birthday" ? "May the year ahead be your best one yet." : "Thank you for every one of them.",
    document: null,
    album_key: null,
    link: null,
    forwarded: false,
    duration_s: null,
    transcript: null,
    celebration: {
      subject: type === "birthday" ? person("emp-ada", "Adaeze Okafor", "Brand Marketing Lead", "Marketing") : person("emp-tunde", "Tunde Bello", "Operations Lead", "Operations"),
      years: type === "anniversary" ? 3 : null,
      since: type === "anniversary" ? "2023-10-22" : null,
      count: 8,
      mine: false,
      fans: [person("emp-tolu", "Tolu Adeyemi"), person("emp-ife", "Ifeoma Nwosu"), person("emp-kemi", "Kemi Ogunleye")],
      wishes: [wish(1, "Tolu Adeyemi", "Happy birthday, Ada!"), wish(2, "Kemi Ogunleye", "Enjoy the day.", true)],
      wish_count: 5,
      ...over,
    },
    recognition: null,
    poll: null,
    announcement: null,
    status: null,
    deleted: false,
    edited_at: null,
    can_edit: false,
    can_delete: false,
    can_close: false,
    pinned_until: null,
    can_pin: false,
  };
}

const show = (m: Message, props: { onCelebrate?: () => Promise<unknown>; onChange?: (m: Message) => void; onReload?: () => void } = {}) =>
  render(
    <ModalProvider>
      <Post m={m} q="" onCelebrate={props.onCelebrate ?? (async () => undefined)} onVote={() => undefined} onChange={props.onChange} onReload={props.onReload} />
      <Toaster />
    </ModalProvider>,
  );

describe("the celebration cards", () => {
  it("a birthday: the person, the line, Celebrate and Send Wishes, who celebrated and the latest two wishes", () => {
    show(card("birthday"));
    const c = screen.getByRole("article", { name: "Birthday, Adaeze Okafor" });
    expect(within(c).getByRole("heading", { name: "Happy Birthday, Adaeze" })).toBeTruthy();
    expect(within(c).getByText("Adaeze Okafor, Brand Marketing Lead")).toBeTruthy();
    expect(within(c).getByText("May the year ahead be your best one yet.")).toBeTruthy();
    expect(within(c).getByText("Tolu, Ifeoma and 6 others celebrated")).toBeTruthy();
    expect(within(c).getByRole("list", { name: "Wishes" }).querySelectorAll("li")).toHaveLength(2);
    expect(within(c).getByText("5 wishes")).toBeTruthy();
    expect(within(c).getByRole("button", { name: /View All/ })).toBeTruthy();
    // Only the caller's own wish offers Delete Wish.
    expect(within(c).getAllByRole("button", { name: "Delete Wish" })).toHaveLength(1);
  });

  it("an anniversary: the years in the laurel, the line, and the day the person joined", () => {
    show(card("anniversary", { wishes: [], wish_count: 0, count: 0, fans: [] }));
    const c = screen.getByRole("article", { name: "Work anniversary, Tunde Bello" });
    expect(within(c).getByRole("img", { name: "3 years at MyCity" })).toBeTruthy();
    expect(within(c).getByText("Operations Lead, Operations")).toBeTruthy();
    expect(within(c).getByText("Three years at MyCity today. Thank you for every one of them.")).toBeTruthy();
    expect(within(c).getByText("Joined 22/10/2023")).toBeTruthy();
    expect(within(c).getByText("Be the first to celebrate")).toBeTruthy();
    expect(within(c).queryByRole("list", { name: "Wishes" })).toBeNull();
  });

  it("an anniversary with no start date reads another year, with no Joined line", () => {
    show(card("anniversary", { years: null, since: null }));
    expect(screen.getByRole("img", { name: "Another year at MyCity" })).toBeTruthy();
    expect(screen.getByText("Another year at MyCity today. Thank you for every one of them.")).toBeTruthy();
    expect(screen.queryByText(/Joined/)).toBeNull();
  });

  it("Celebrate hands back its request, and reads Celebrated once pressed", async () => {
    const user = userEvent.setup();
    let settle: () => void = () => undefined;
    const onCelebrate = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { unmount } = show(card("birthday"), { onCelebrate });
    await user.click(screen.getByRole("button", { name: "Celebrate" }));
    expect(onCelebrate).toHaveBeenCalledTimes(1);
    // One press, one request: a second press while the first is out is refused.
    await user.click(screen.getByRole("button", { name: "Celebrate" }));
    expect(onCelebrate).toHaveBeenCalledTimes(1);
    settle();
    unmount();
    show(card("birthday", { mine: true }));
    expect(screen.getByRole("button", { name: "Celebrated" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Send Wishes asks for a wish on its field, then sends it and shows the card the server answers", async () => {
    const user = userEvent.setup();
    const answered = card("birthday", { wish_count: 6 });
    const call = vi.spyOn(api, "call").mockResolvedValue(answered as never);
    const onChange = vi.fn();
    show(card("birthday"), { onChange });
    await user.click(screen.getByRole("button", { name: "Send Wishes" }));
    const sheet = await screen.findByRole("dialog", { name: "Send Wishes" });
    await user.click(within(sheet).getByRole("button", { name: "Send Wishes" }));
    await new Promise((r) => setTimeout(r, 50)); console.log("SHEET:", sheet.textContent, "BODY:", document.body.textContent?.slice(0, 600));
    expect(await within(sheet).findByText("Write a wish")).toBeTruthy();
    expect(call).not.toHaveBeenCalled();

    await user.type(within(sheet).getByLabelText("Wish"), "Have a wonderful day, Ada.");
    await user.click(within(sheet).getByRole("button", { name: "Send Wishes" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("POST /api/v1/community/messages/:id/wishes", { params: { id: answered.community_message_id }, body: { body: "Have a wonderful day, Ada." } }),
    );
    expect(onChange).toHaveBeenCalledWith(answered);
    expect(await screen.findByText("Wishes sent")).toBeTruthy();
  });

  it("a wish is deleted by its author after asking once, and the card reads its wishes again", async () => {
    const user = userEvent.setup();
    const call = vi.spyOn(api, "call").mockResolvedValue(null as never);
    const onReload = vi.fn();
    show(card("birthday"), { onReload });
    await user.click(screen.getByRole("button", { name: "Delete Wish" }));
    const ask = await screen.findByRole("alertdialog");
    await user.click(within(ask).getByRole("button", { name: "Delete Wish" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("DELETE /api/v1/community/wishes/:id", { params: { id: wish(2, "", "").community_wish_id } }));
    expect(onReload).toHaveBeenCalled();
    expect(await screen.findByText("Wish deleted")).toBeTruthy();
  });
});

describe("the cards a person has seen on this device", () => {
  it("are remembered per person, so a card bursts once for each of them", () => {
    expect(cardSeen("card-1", "user-a")).toBe(false);
    markCardSeen("card-1", "user-a");
    expect(cardSeen("card-1", "user-a")).toBe(true);
    expect(cardSeen("card-1", "user-b")).toBe(false);
  });

  it("keep the newest 200", () => {
    for (let i = 0; i < 205; i++) markCardSeen(`card-${i}`, "user-a");
    expect(cardSeen("card-0", "user-a")).toBe(false);
    expect(cardSeen("card-204", "user-a")).toBe(true);
  });
});
