// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModalProvider } from "@mycity/ui";
import { axe, axeMatchers, installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { ScreenActionProvider } from "@/shell/screen-action";
import Community from "./index";

/**
 * Forwarding on the in-browser mock (docs/guides/community.md §3 step 19): a message's menu
 * forwards it to up to 5 chats, Select picks several to forward together, and the copies arrive
 * marked Forwarded. The mock's #ember-to-remember holds texts, a photo, an album and a PDF.
 */

expect.extend(axeMatchers);
installMatchMedia();
for (const name of ["ResizeObserver", "IntersectionObserver"] as const) {
  if (!(name in window)) {
    (window as unknown as Record<string, unknown>)[name] = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness() {
  auth = useAuth();
  return auth.status === "signed-in" ? <Community tab="channels" id={null} /> : null;
}

async function asCynthia() {
  window.history.replaceState(null, "", "/community?tab=channels");
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Harness />
          </ScreenActionProvider>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    const next = await auth!.signIn("cynthia@mycityapp.io", "demo1234");
    if (next?.kind === "code") await auth!.finishTwoStep(next.ticket, "482913");
  });
}

/** A channel's messages as the API sends them, by the channel's name. */
async function messagesIn(name: string) {
  const list = await api.call("GET /api/v1/community/channels", { query: { q: name } });
  const id = list.data.find((c) => c.name === name)!.community_channel_id;
  return (await api.call("GET /api/v1/community/channels/:id/messages", { params: { id } })).data;
}

/** The open conversation's row of the message whose words are `text` (the list beside it shows last lines too). */
const rowOf = async (text: RegExp) => {
  await waitFor(() => expect(document.querySelector("[data-thread]")).not.toBeNull());
  const thread = document.querySelector<HTMLElement>("[data-thread]")!;
  return (await within(thread).findByText(text)).closest<HTMLElement>(".group")!;
};
/** Opens the message's menu, again if a reload of the conversation drew its row afresh meanwhile. */
const openMenuOf = async (text: RegExp) => {
  await waitFor(async () => {
    if (!screen.queryByRole("menu")) {
      const row = await rowOf(text);
      fireEvent.pointerDown(within(row).getByRole("button", { name: "Message actions" }), { button: 0, pointerType: "mouse" });
    }
    expect(screen.getByRole("menu")).toBeTruthy();
  });
};

describe("forwarding", () => {
  it("forwards one message from its menu to two chats, where it arrives marked Forwarded", async () => {
    await asCynthia();
    fireEvent.click(await screen.findByRole("button", { name: /ember-to-remember/ }, { timeout: 5000 }));
    await openMenuOf(/Studio is booked for the 22nd/);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Forward" }));

    const dialog = await screen.findByRole("dialog", { name: "Forward To" });
    const options = await within(dialog).findAllByRole("option");
    expect(options.some((o) => o.textContent?.includes("#general"))).toBe(true);
    // Nobody posts straight into #announcements, so it is not offered.
    expect(options.some((o) => o.textContent?.includes("#announcements"))).toBe(false);
    expect(await axe(dialog)).toHaveNoViolations();

    // Forward with nothing picked says so, on the sheet.
    fireEvent.click(within(dialog).getByRole("button", { name: "Forward" }));
    expect(await within(dialog).findByText("Choose a chat")).toBeTruthy();

    fireEvent.click(options.find((o) => o.textContent?.includes("#general"))!);
    fireEvent.click(options.find((o) => o.textContent?.includes("Hauwa"))!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Forward To" })).toBeNull());

    const general = await messagesIn("general");
    expect(general.at(-1)).toMatchObject({ forwarded: true, mine: true, body: expect.stringMatching(/^Studio is booked for the 22nd/) });
  }, 30000);

  it("picks several with Select, in the bar's count, and forwards them together in order", async () => {
    await asCynthia();
    fireEvent.click(await screen.findByRole("button", { name: /ember-to-remember/ }, { timeout: 5000 }));
    await openMenuOf(/Shot list for the Enugu segment/);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Select" }));
    expect(await screen.findByText("1 Selected")).toBeTruthy();

    // A tap on another message ticks it, and opens nothing.
    fireEvent.click(await rowOf(/Link it to the MOU/));
    expect(await screen.findByText("2 Selected")).toBeTruthy();
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
    expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    const dialog = await screen.findByRole("dialog", { name: "Forward To" });
    fireEvent.click((await within(dialog).findAllByRole("option")).find((o) => o.textContent?.includes("#operations"))!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.queryByText(/Selected$/)).toBeNull());
    expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();

    const copies = (await messagesIn("operations")).filter((m) => m.forwarded);
    expect(copies.map((m) => m.body)).toEqual([expect.stringMatching(/^Shot list for the Enugu/), expect.stringMatching(/^Good\. Link it to the MOU/)]);
  }, 30000);
});
