// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "./AuthProvider";

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe("the session (PR 2 question 2)", () => {
  it("signs in, and when the session ends mid-work keeps the person and asks again in place", async () => {
    mockSession.set(null);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"), { timeout: 5000 });
    await act(() => result.current.signIn("cynthia@mycityapp.io", "demo1234"));
    expect(result.current.status).toBe("signed-in");
    act(() => result.current.clearJustSignedIn());

    // The refresh cookie is gone (the session was ended elsewhere): the next call is refused.
    mockSession.set(null);
    await act(async () => {
      await api.call("GET /api/v1/notifications/badges").catch(() => undefined);
    });
    expect(result.current.status).toBe("expired");
    expect(result.current.me?.display_name).toBe("Cynthia Osakunih");

    await act(() => result.current.signIn("cynthia@mycityapp.io", "demo1234"));
    expect(result.current.status).toBe("signed-in");
    // Carrying on is not a fresh sign-in: the clock prompt does not open again.
    expect(result.current.justSignedIn).toBe(false);
  }, 15000);

  it("signs out to the sign-in screen", async () => {
    mockSession.set(null);
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("signed-out"), { timeout: 5000 });
    await act(() => result.current.signIn("chidera@mycityapp.io", "demo1234"));
    await act(() => result.current.signOut());
    expect(result.current).toMatchObject({ status: "signed-out", me: null });
  }, 15000);
});
