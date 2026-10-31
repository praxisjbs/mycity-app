// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/api/client";

const m = vi.hoisted(() => ({
  signIn: vi.fn(),
  finishTwoStep: vi.fn(),
}));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    status: "locked",
    me: { display_name: "Ada Obi", email: "ada@mycityapp.io" },
    lockReason: "idle",
    signIn: m.signIn,
    signInWithPin: vi.fn(),
    finishTwoStep: m.finishTwoStep,
    signInWithPasskey: vi.fn(),
    signOut: vi.fn(),
  }),
  useMyPhoto: () => null,
}));
vi.mock("@/api/hooks", () => ({ useApi: () => ({ data: undefined, reload: vi.fn() }) }));

import { LockSheet } from "./LockSheet";

/** Unlocks with the password, to the two-step code. */
async function toCode() {
  m.signIn.mockResolvedValueOnce({ kind: "code", ticket: "t1" });
  render(<LockSheet />);
  await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
  await screen.findByText("Enter Code");
}

describe("the lock screen's code step", () => {
  beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("says where a recovery code comes from, and Back returns to the password", async () => {
    await toCode();
    expect(screen.getByText("From your authenticator app")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use Recovery Code" }));
    expect(screen.getByText("One of your recovery codes")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Session Locked")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("an expired code goes back to the first step, saying why", async () => {
    await toCode();
    m.finishTwoStep.mockRejectedValueOnce(new ApiError(400, { error: { code: "CHALLENGE_EXPIRED", message: "This request has expired. Start again." } } as never));
    await userEvent.click(screen.getByRole("button", { name: "Use Recovery Code" }));
    await userEvent.type(screen.getByLabelText("Recovery Code"), "ABCD-EFGH-JK");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("This request has expired. Start again.")).toBeTruthy();
    expect(screen.getByText("Session Locked")).toBeTruthy();
  });
});
