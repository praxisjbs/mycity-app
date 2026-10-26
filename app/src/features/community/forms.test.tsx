// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@mycity/ui";
import { atLeast4, pollMarks, refused } from "./index";

/**
 * Staff Community's form rules (docs/guides/community.md §10): a headline, a message or a question
 * says when it is too short, a refused poll's marks land on its own fields, and a channel save's
 * refusal is marked on Purpose (the API's description) or said when no field holds it.
 */

vi.mock("@mycity/ui", async (original) => {
  const ui = await original<typeof import("@mycity/ui")>();
  return { ...ui, toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn(), success: vi.fn(), dismiss: vi.fn() }) };
});

describe("Staff Community's forms", () => {
  it("asks for the text when empty and says it is too short at one to three characters", () => {
    const rule = atLeast4("Add a headline");
    expect(rule("")).toBe("Add a headline");
    expect(rule("Hi")).toBe("At least 4 characters");
    expect(rule("Town hall")).toBeNull();
  });

  it("puts a refused poll's marks on its question and options", () => {
    expect(pollMarks({ body: ["Required"], "options.2": ["At most 80 characters"] })).toEqual({ q: ["Required"], o3: ["At most 80 characters"] });
  });

  it("marks Purpose for the API's description, and says a refusal no field holds", async () => {
    const { toast } = await import("@mycity/ui");
    const mark = vi.fn();
    refused(new ApiError(422, { error: { code: "VALIDATION_FAILED", message: "Check the highlighted fields", fields: { description: ["At most 300 characters"] } } }), mark);
    expect(mark).toHaveBeenCalledWith({ purpose: ["At most 300 characters"] });
    refused(new ApiError(429, { error: { code: "RATE_LIMITED", message: "Too many requests. Wait a moment and try again." } }), mark);
    expect(toast.error).toHaveBeenCalledWith("Too many requests. Wait a moment and try again.");
  });
});
