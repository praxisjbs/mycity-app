import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { describedBy, useControlIds } from "./ids";

describe("useControlIds", () => {
  it("gives one control its label, help and error ids, valid as CSS selectors", () => {
    const { result } = renderHook(() => useControlIds("leave_type"));
    const { id, labelId, helpId, errorId } = result.current;
    expect(id).toMatch(/^leave_type-[A-Za-z0-9_-]+$/);
    expect([labelId, helpId, errorId]).toEqual([`${id}-label`, `${id}-help`, `${id}-error`]);
    expect(() => document.querySelector(`#${id}`)).not.toThrow();
  });

  it("is stable across renders and unique per control", () => {
    const a = renderHook(() => useControlIds("amount"));
    const first = a.result.current.id;
    a.rerender();
    expect(a.result.current.id).toBe(first);
    const b = renderHook(() => useControlIds("amount"));
    expect(b.result.current.id).not.toBe(first);
  });

  it("makes a stem with spaces safe", () => {
    const { result } = renderHook(() => useControlIds("start date"));
    expect(result.current.id.startsWith("start-date-")).toBe(true);
  });
});

describe("describedBy", () => {
  it("joins the parts shown and is undefined when none are", () => {
    expect(describedBy("a-help", false, "a-error", null, undefined, "")).toBe("a-help a-error");
    expect(describedBy(false, undefined)).toBeUndefined();
  });
});
