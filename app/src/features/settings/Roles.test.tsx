// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { api } from "@/api/client";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { Roles } from "./Roles";

/**
 * Settings · Roles & Permissions on the in-browser mock (docs/guides/foundation.md §10): a role's
 * People tab opens on the active logins that hold it, the people its count counts; an invited,
 * suspended or closed login sits behind its status chip, so the count and the list agree.
 */

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.setConfig({ testTimeout: 30000 });
beforeEach(() => setViewport(1440));
afterEach(() => cleanup());

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function open() {
  mockSession.set(null);
  invalidate("/api/v1");
  window.history.replaceState({}, "", "/settings?tab=roles");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>
            <Roles />
          </Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn("cynthia@mycityapp.io", "demo1234");
  });
}

describe("a role's People tab", () => {
  it("lists the active logins its count counts; an invited login is behind its status chip", async () => {
    await open();
    // A login invited and not yet signed in, and the role it holds.
    const invited = (await api.call("GET /api/v1/users", { query: { status: "invited" } })).data[0]!;
    const role = invited.roles[0]!;
    const active = (await api.call("GET /api/v1/users", { query: { status: "active", role: role.code } })).data;
    expect(active.length).toBeGreaterThan(0);

    fireEvent.click(await screen.findByText(role.name, { selector: "b" }, { timeout: 5000 }));
    // The role's count is the active logins, once the role has been read.
    const count = active.length === 1 ? "1 person" : `${active.length} people`;
    await screen.findByText(new RegExp(`^${count} · `), {}, { timeout: 5000 });
    fireEvent.mouseDown(within(screen.getByRole("tablist", { name: "Role" })).getByRole("tab", { name: /^People/ }), { button: 0 });

    const status = await screen.findByRole("group", { name: "Status" });
    expect(within(status).getByRole("button", { name: /^Active/ }).getAttribute("aria-pressed")).toBe("true");
    await screen.findByText(active[0]!.display_name);
    expect(screen.queryByText(invited.display_name)).toBeNull();

    fireEvent.click(within(status).getByRole("button", { name: /^Invited/ }));
    expect(await screen.findByText(invited.display_name)).toBeTruthy();
    expect(screen.queryByText(active[0]!.display_name)).toBeNull();

    // Nobody closed holds it: the empty state says to try another status.
    fireEvent.click(within(status).getByRole("button", { name: /^Left/ }));
    expect(await screen.findByText("Nobody Here")).toBeTruthy();
  });
});
