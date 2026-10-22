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
import { partsOf, SummaryCard, WriteWithAi, type ComposeNow } from "./Assist";
import Mailbox from "./index";

/**
 * Write With AI and Summarise Thread on the in-browser mock (docs/guides/mailbox.md §3 steps 12 to
 * 14, §10): the step drafts, asks, or tidies, and Use Draft hands the draft to the composer; the
 * Summary card shows the gist, Key Points and Asked of You above the conversation.
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

async function signedIn(children: React.ReactNode) {
  window.history.replaceState(null, "", "/mailbox?tab=inbox");
  mockSession.set(null);
  invalidate("/api/v1");
  function Gate() {
    auth = useAuth();
    return auth.status === "signed-in" ? <>{children}</> : null;
  }
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <ScreenActionProvider>
            <Gate />
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

const reply: ComposeNow = {
  in_reply_to: "00000000-0000-4000-8000-000000000001",
  to: ["o.adesanya@mtn.ng"],
  cc: [],
  subject: "Re: Ember to Remember, venue confirmations",
  attachments: [],
  own_html: "<p></p>",
  quoted_html: "<p>On 22/10/2026 09:14, MTN Partnerships wrote:</p><blockquote><p>Could you send the final venue list?</p></blockquote>",
};

describe("the composer's own words and the quoted mail under them", () => {
  it("splits a reply's quotation off, even before anything is written over it", () => {
    const quote = "<p>On 22/10/2026 09:14, Ada wrote:</p><blockquote><p>Can we meet?</p></blockquote>";
    expect(partsOf(`<p></p><p></p>${quote}`)).toEqual({ own: "<p></p><p></p>", quoted: quote });
    expect(partsOf(`<p>Monday works.</p>${quote}`)).toEqual({ own: "<p>Monday works.</p>", quoted: quote });
    expect(partsOf("<p>Just a new message.</p>")).toEqual({ own: "<p>Just a new message.</p>", quoted: "" });
  });
});

describe("Write With AI", () => {
  it("drafts a reply from the conversation, shows it, and Use Draft hands it over", async () => {
    await signedIn(<div />);
    const use = vi.fn();
    const call = vi.spyOn(api, "call");
    render(<WriteWithAi compose={reply} hidden={false} back={vi.fn()} use={use} />);
    expect(screen.queryByRole("radiogroup", { name: "Write or Tidy" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /What To Say/ }), { target: { value: "confirm the eight venues" } });
    fireEvent.click(screen.getByRole("button", { name: "Write Draft" }));
    await screen.findByRole("button", { name: "Use Draft" }, { timeout: 5000 });
    const sent = call.mock.calls.find(([key]) => key === "POST /api/v1/mailbox/assist")![1] as { body: Record<string, unknown> };
    expect(sent.body).toMatchObject({ mode: "write", in_reply_to: reply.in_reply_to, instruction: "confirm the eight venues", write_anyway: false });
    expect(screen.getByRole("button", { name: "Try Again" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use Draft" }));
    expect(use).toHaveBeenCalledWith({ body_html: expect.stringMatching(/^<p>Good morning,<\/p>.*Confirm the eight venues\..*<p>Kind regards,<\/p>$/), subject: null });
  }, 30000);

  it("asks first when a fact is missing, then Write Anyway drafts without asking", async () => {
    await signedIn(<div />);
    const call = vi.spyOn(api, "call");
    render(<WriteWithAi compose={{ ...reply, to: [] }} hidden={false} back={vi.fn()} use={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: /What To Say/ }), { target: { value: "propose a day for the site visit" } });
    fireEvent.click(screen.getByRole("button", { name: "Write Draft" }));
    expect(await screen.findByText("Which day and time suit you?", {}, { timeout: 5000 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write Anyway" }));
    await screen.findByRole("button", { name: "Use Draft" }, { timeout: 5000 });
    const last = call.mock.calls.filter(([key]) => key === "POST /api/v1/mailbox/assist").pop()![1] as { body: Record<string, unknown> };
    expect(last.body.write_anyway).toBe(true);
  }, 30000);

  it("on a new message says what is missing on the field; with words written, offers Tidy Up", async () => {
    await signedIn(<div />);
    const fresh: ComposeNow = { ...reply, in_reply_to: null, quoted_html: "", subject: "" };
    const { unmount } = render(<WriteWithAi compose={fresh} hidden={false} back={vi.fn()} use={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Write Draft" }));
    expect(await screen.findByText("Say what to write", {}, { timeout: 5000 })).toBeTruthy();
    unmount();

    render(<WriteWithAi compose={{ ...fresh, own_html: "<p>pls send the venue list by monday</p>" }} hidden={false} back={vi.fn()} use={vi.fn()} />);
    expect(screen.getByRole("radiogroup", { name: "Write or Tidy" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tidy Email" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Add a Note" }));
    expect(screen.getByRole("textbox", { name: /Note/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record Note" }).textContent).toContain("Dictate");
  }, 30000);

  it("has no accessibility violations", async () => {
    const { container } = render(<WriteWithAi compose={reply} hidden={false} back={vi.fn()} use={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Summarise Thread", () => {
  const summary = {
    available: true,
    mail_thread_id: "00000000-0000-4000-8000-000000000002",
    gist: "MTN confirmed eight venues for the Lagos leg.",
    key_points: ["Brand signed off the placement.", "Two venues await a site visit."],
    asked_of_you: [],
    message_count: 1,
    summarised_at: "2026-10-22T09:00:00.000Z",
    ai_run_id: null,
  };

  it("shows loading lines, then the gist and the sections that have something", () => {
    const { rerender } = render(<SummaryCard summary={null} close={vi.fn()} />);
    expect(screen.queryByText(summary.gist)).toBeNull();
    rerender(<SummaryCard summary={summary} close={vi.fn()} />);
    expect(screen.getByText(summary.gist)).toBeTruthy();
    expect(screen.getByText("Key Points")).toBeTruthy();
    expect(screen.queryByText("Asked of You")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy Summary" })).toBeTruthy();
  });

  it("opens above the conversation from the reader", async () => {
    await signedIn(<Mailbox tab="inbox" id={null} />);
    const reader = await screen.findByRole("button", { name: "Summarise Thread" }, { timeout: 10000 });
    fireEvent.click(reader);
    expect(await screen.findByRole("heading", { name: /Summary/ }, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText(/wrote about/, {}, { timeout: 5000 })).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Close Summary" }).closest("span")!).getByRole("button", { name: "Copy Summary" })).toBeTruthy();
  }, 30000);

  it("has no accessibility violations", async () => {
    const { container } = render(<SummaryCard summary={{ ...summary, asked_of_you: ["Send the final venue list by Monday."] }} close={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
