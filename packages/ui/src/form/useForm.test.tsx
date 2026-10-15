import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { rules, useForm } from "./useForm";

describe("useForm (interim)", () => {
  it("marks a field only once touched, then on every change", () => {
    const { result } = renderHook(() => useForm({ email: "" }, { email: rules.email }));
    expect(result.current.field("email").state).toBeUndefined();
    act(() => result.current.field("email").onChange("ada"));
    expect(result.current.field("email").state).toBe("bad");
    expect(result.current.field("email").message).toBe("Needs an @");
    act(() => result.current.field("email").onChange("ada@mycity.app"));
    expect(result.current.field("email").state).toBe("good");
  });

  it("check() marks everything and reports cleanliness", () => {
    const { result } = renderHook(() => useForm({ name: "" }, { name: rules.required() }));
    let ok = true;
    act(() => {
      ok = result.current.check();
    });
    expect(ok).toBe(false);
    expect(result.current.status("name")).toEqual({ state: "bad", message: "Required" });
  });

  it("shows a server error until the field changes", () => {
    const { result } = renderHook(() => useForm({ email: "ada@mycity.app" }));
    act(() => result.current.setServerErrors({ email: ["Already in use"] }));
    expect(result.current.field("email").message).toBe("Already in use");
    act(() => result.current.field("email").onChange("ola@mycity.app"));
    expect(result.current.field("email").message).toBeUndefined();
  });

  it("keeps every rule message to four words", () => {
    for (const msg of [rules.required()(""), rules.email(""), rules.email("x"), rules.email("x@y"), rules.amount(""), rules.amount("1.234")]) {
      expect(String(msg).split(" ").length).toBeLessThanOrEqual(4);
    }
  });
});
