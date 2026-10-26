// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession, sid } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RecordMarks } from "@/features/notifications/marks";
import { RouterProvider, useRouter } from "@/lib/router";
import { Worksites } from "./Worksites";

/**
 * People · Worksites says where its count waits (docs/guides/notifications.md §6, the QA
 * register's screenshot of 26/10/2026): Worksites 2, both about a site withdrawn on the Temporary
 * side. The side, the view and the chip holding them carry the 2, and the screen opens there. The
 * API's answer for this screen is given here; the rest of the screen runs on the in-browser mock.
 */
const { VIEWS } = vi.hoisted(() => ({
  VIEWS: {
    temporary: { unread: 2, urgent: false },
    "temporary/sites": { unread: 2, urgent: false },
    "temporary/sites/withdrawn": { unread: 2, urgent: false },
  } as Record<string, { unread: number; urgent: boolean }>,
}));
vi.mock("@/api/hooks", async (load) => {
  const real = await load<typeof import("@/api/hooks")>();
  const useApi = ((key: string, opts?: unknown) =>
    key === "GET /api/v1/notifications/views" ? { data: { views: VIEWS } } : (real.useApi as (k: string, o?: unknown) => unknown)(key, opts)) as typeof real.useApi;
  return { ...real, useApi };
});

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
beforeEach(() => setViewport(1440));
afterEach(cleanup);

let auth: ReturnType<typeof useAuth> | null = null;
let router: ReturnType<typeof useRouter> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  router = useRouter();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function asOperations(count: number) {
  mockSession.set(null);
  invalidate("/api/v1");
  window.history.replaceState(null, "", "/people?tab=worksites");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <RecordMarks module="people" tab="worksites" count={count}>
              <Worksites />
            </RecordMarks>
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
  await screen.findByText("Worksites", { selector: "h1" }, { timeout: 5000 });
}

const checked = (name: string) => screen.getByRole("radio", { name }).getAttribute("aria-checked");

describe("People · Worksites, where its count waits", () => {
  it("Worksites 2 on Temporary: the side and the chip holding them say so, and the screen opens there", async () => {
    await asOperations(2);
    await waitFor(() => expect(checked("Temporary 2")).toBe("true"), { timeout: 5000 });
    expect(checked("Permanent")).toBe("false");
    const chips = await screen.findByRole("group", { name: "Temporary Sites" }, { timeout: 5000 });
    expect(within(chips).getByRole("button", { name: "All 2" }).getAttribute("aria-pressed")).toBe("true");
    // Withdrawn has no chip of its own: All holds it, and no other chip claims it.
    expect(within(chips).getByRole("button", { name: "Cancelled" })).toBeTruthy();
    expect(within(chips).getByRole("button", { name: "Awaiting Approval" })).toBeTruthy();
  }, 30000);

  it("a site's link that arrives while Permanent is showing opens Temporary and the site", async () => {
    await asOperations(0);
    expect(checked("Permanent")).toBe("true");
    act(() => router!.navigate(`/people?tab=worksites&site=${sid("ts:1")}`));
    await waitFor(() => expect(checked("Temporary")).toBe("true"), { timeout: 5000 });
    expect(await screen.findByRole("dialog", { name: "TS-0001 · Partner Training Week" }, { timeout: 5000 })).toBeTruthy();
  }, 30000);
});
