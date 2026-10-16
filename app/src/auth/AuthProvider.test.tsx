// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { mockSession } from "@/api/mock/core";
import { AuthProvider, useAuth } from "./AuthProvider";

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

// Each test's provider goes, so it does not hear the next test's sign-in on the shared channel.
afterEach(cleanup);

describe("the session", () => {
  it("signs in, and when the session ends mid-work keeps the person and locks in place", async () => {
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
    expect(result.current.status).toBe("locked");
    expect(result.current.lockReason).toBe("ended");
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

  describe("the clock", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function signedIn() {
      mockSession.set(null);
      const hook = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(hook.result.current.status).toBe("signed-out"), { timeout: 5000 });
      await act(() => hook.result.current.signIn("cynthia@mycityapp.io", "demo1234"));
      return hook;
    }
    const lookAgain = () => act(async () => void document.dispatchEvent(new Event("visibilitychange")));

    it("locks after the idle limit with no activity, and ends the session on the server", async () => {
      const { result } = await signedIn();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 31 * 60_000);
      await lookAgain();
      expect(result.current).toMatchObject({ status: "locked", lockReason: "idle" });
      await waitFor(() => expect(mockSession.get()).toBeNull());
    }, 15000);

    it("stays signed in while the person is active", async () => {
      const { result } = await signedIn();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 20 * 60_000);
      act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
      vi.setSystemTime(Date.now() + 20 * 60_000);
      await lookAgain();
      expect(result.current.status).toBe("signed-in");
    }, 15000);

    it("locks at the session's time limit, however active", async () => {
      const { result } = await signedIn();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 121 * 60_000);
      act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
      await lookAgain();
      expect(result.current).toMatchObject({ status: "locked", lockReason: "time" });
    }, 15000);

    it.runIf(typeof BroadcastChannel !== "undefined")("locks when another tab locks", async () => {
      const { result } = await signedIn();
      const other = new BroadcastChannel("mycity-session");
      other.postMessage({ t: "locked", reason: "time" });
      await waitFor(() => expect(result.current).toMatchObject({ status: "locked", lockReason: "time" }));
      other.close();
    }, 15000);
  });
});
