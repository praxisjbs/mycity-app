// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "@mycity/ui";
import { installMatchMedia, setViewport } from "@mycity/ui/testing";
import { invalidate } from "@/api/hooks";
import { mockSession } from "@/api/mock/core";
import { byKey } from "@/api/mock/data/people";
import { AuthProvider, useAuth } from "@/auth/AuthProvider";
import { RouterProvider } from "@/lib/router";
import { EmployeeDocuments } from "./EmployeeDocuments";

/**
 * The Employee 360's Documents tab on the in-browser mock (docs/guides/offers.md §2, foundation.md §2):
 * on a wide desktop a document opens beside the list, never in a centred dialog (F31); on a phone
 * nothing opens until a row is tapped, then a sheet. Upload Document's "What Is It" is the upload's
 * own contract field (gate 12), its limit shown on the field.
 */

installMatchMedia();
if (!("ResizeObserver" in window)) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => setViewport(1440));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let auth: ReturnType<typeof useAuth> | null = null;
function Harness({ children }: { children?: ReactNode }) {
  auth = useAuth();
  return auth.status === "signed-in" ? <>{children}</> : null;
}

async function signedInAs(email: string, screenUnderTest: ReactNode) {
  mockSession.set(null);
  invalidate("/api/v1");
  render(
    <RouterProvider>
      <AuthProvider>
        <ModalProvider>
          <Harness>{screenUnderTest}</Harness>
        </ModalProvider>
      </AuthProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(auth?.status).toBe("signed-out"), { timeout: 10000 });
  await act(async () => {
    await auth!.signIn(email, "demo1234");
  });
}

const id = () => byKey("chidera")!.employee_id;

describe("Employee 360 · Documents", () => {
  it("on a desktop a document opens beside the list, and Verify Document checks it there", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeDocuments id={id()} />);
    expect((await screen.findAllByText("Employment contract")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Proof of residential address"));
    // Side by side: the record is a card on the page, not a dialog.
    await waitFor(() => expect(screen.getAllByRole("heading", { name: "Proof of residential address" }).length).toBeGreaterThan(0));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Verify Document" }));
    await waitFor(() => expect(screen.getAllByText("Verified").length).toBeGreaterThan(1));
  }, 30000);

  it("on a phone nothing opens until a row is tapped, then the document opens in a sheet", async () => {
    setViewport(390);
    await signedInAs("cynthia@mycityapp.io", <EmployeeDocuments id={id()} />);
    expect(await screen.findAllByText("Employment contract")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    fireEvent.click(screen.getAllByText("Employment contract")[0]!);
    const sheet = await screen.findByRole("dialog", { name: "Document" });
    expect(within(sheet).getAllByText("Employment contract").length).toBeGreaterThan(0);
  }, 30000);

  it("Upload Document checks What Is It against the upload's contract as it is typed", async () => {
    await signedInAs("cynthia@mycityapp.io", <EmployeeDocuments id={id()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Upload Document" }));
    const d = await screen.findByRole("dialog", { name: "Upload Document" });
    const field = within(d).getByLabelText("What Is It") as HTMLInputElement;
    expect(field.maxLength).toBe(200);
    fireEvent.change(field, { target: { value: "Valid ID" } });
    fireEvent.blur(field);
    expect(field.value).toBe("Valid ID");
  }, 30000);
});
