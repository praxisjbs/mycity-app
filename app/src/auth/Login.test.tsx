// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/api/client";

const m = vi.hoisted(() => ({ signIn: vi.fn(), call: vi.fn(), path: "/login", params: new URLSearchParams() }));
vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ signIn: m.signIn, signInWithPin: vi.fn(), signInWithPasskey: vi.fn(), finishTwoStep: vi.fn(), finishSetup: vi.fn() }),
}));
vi.mock("@/api/hooks", () => ({ useApi: () => ({ data: undefined, reload: vi.fn() }) }));
vi.mock("@/lib/router", () => ({ useRouter: () => ({ location: { path: m.path, params: m.params }, navigate: vi.fn() }) }));
vi.mock("@/api/client", async (original) => ({ ...(await original<typeof import("@/api/client")>()), api: { call: m.call } }));

import { Login } from "./Login";

describe("signing in with a password", () => {
  beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    m.path = "/login";
    m.params = new URLSearchParams();
  });

  it("a refused password says why under Sign In, and the cleared field is not marked empty", async () => {
    m.signIn.mockRejectedValueOnce(new ApiError(401, { error: { code: "INVALID_CREDENTIALS", message: "That email and password do not match." } } as never));
    render(<Login />);
    await userEvent.type(screen.getByLabelText("Email"), "aaron@mycityapp.io");
    await userEvent.type(screen.getByLabelText("Password"), "Not-His-Password-1");
    await userEvent.click(screen.getByRole("button", { name: "Sign In" }));
    expect(await screen.findByText("That email and password do not match.")).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Enter your password")).toBeNull();
  });
});

describe("choosing a password from an invitation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    m.path = "/login";
    m.params = new URLSearchParams();
  });

  it("an empty Confirm Password asks for it again, and a different one says it does not match", async () => {
    m.path = "/welcome";
    m.params = new URLSearchParams({ token: "t".repeat(43) });
    m.call.mockResolvedValueOnce({ purpose: "invite", first_name: "Aaron", email: "aaron@mycityapp.io" });
    render(<Login />);
    expect(await screen.findByText("Set Your Password")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("New Password"), "Lagos-City-2026!");
    await userEvent.click(screen.getByLabelText("Confirm Password"));
    await userEvent.click(screen.getByLabelText("New Password"));
    expect(screen.getByText("Enter it again")).toBeTruthy();
    expect(screen.queryByText("Does not match")).toBeNull();
    await userEvent.type(screen.getByLabelText("Confirm Password"), "Lagos-City-2025!");
    expect(screen.getByText("Does not match")).toBeTruthy();
  });
});
