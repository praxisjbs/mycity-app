import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { setViewport } from "../testing/viewport";
import { useIsMobile, useIsPhone } from "./media";

describe("useIsPhone", () => {
  it("is true at 760 px and below, and follows a resize", () => {
    setViewport(390);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(true);
    act(() => setViewport(761));
    expect(result.current).toBe(false);
    act(() => setViewport(760));
    expect(result.current).toBe(true);
  });

  it("keeps the merged name", () => {
    expect(useIsMobile).toBe(useIsPhone);
  });
});
