import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("skips falsy parts", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("knows the theme's own names", () => {
    expect(cn("h-control", "h-9")).toBe("h-9");
    expect(cn("text-sm text-muted-foreground", "text-body")).toBe("text-muted-foreground text-body");
    expect(cn("text-muted-foreground", "text-foreground")).toBe("text-foreground");
    expect(cn("rounded-ctl", "rounded-card")).toBe("rounded-card");
    expect(cn("shadow-1", "shadow-3")).toBe("shadow-3");
    expect(cn("text-2xs", "text-md")).toBe("text-md");
  });

  it("keeps variants apart", () => {
    expect(cn("h-7 phone:h-control", "h-8")).toBe("phone:h-control h-8");
  });
});
