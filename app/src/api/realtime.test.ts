// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { connectRealtime, emitRealtimeForTest, usePresence, useRealtime } from "./realtime";

describe("realtime", () => {
  it("hands each event to the components listening for it, while they are mounted", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useRealtime("notification", handler));
    emitRealtimeForTest("notification", { notification_id: "n1" });
    expect(handler).toHaveBeenCalledWith({ notification_id: "n1" });
    unmount();
    emitRealtimeForTest("notification", { notification_id: "n2" });
    expect(handler).toHaveBeenCalledOnce();
  });

  it("keeps who is online from presence events", () => {
    const { result } = renderHook(() => usePresence("u1"));
    expect(result.current).toBe(false);
    act(() => emitRealtimeForTest("presence", { user_id: "u1", online: true }));
    expect(result.current).toBe(true);
    act(() => emitRealtimeForTest("presence", { user_id: "u1", online: false }));
    expect(result.current).toBe(false);
  });

  it("connects to nothing on the in-browser mock", async () => {
    await expect(connectRealtime()).resolves.toBeUndefined();
  });
});
