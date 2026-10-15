import { describe, expect, it } from "vitest";
import { SLOTS, content, slot } from "./slots";

describe("slots", () => {
  it("names every slot the gates read", () => {
    expect(Object.values(SLOTS)).toEqual([
      "page-title", "page-subtitle", "title", "kpi-caption", "button", "header", "chart-caption",
      "empty-text", "help", "details", "modal-footer", "nav", "desktop-nav", "phone-nav",
    ]);
    expect(slot("page-title")).toEqual({ "data-ui": "page-title" });
    expect(content).toEqual({ "data-copy": "content" });
  });
});
