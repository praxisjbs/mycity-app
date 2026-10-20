import { describe, expect, it } from "vitest";
import type { PolicyMode, PolicySettings } from "@mycity/contract/contract.gen.ts";
import { POLICY_SECTIONS, policySentences, ruleValue } from "./policy-text";

/**
 * The attendance policy in words (docs/guides/attendance.md §6.15): every rule and mode reads as
 * full sentences, the values People set are in them, and none breaks the copy rules (20 words a
 * sentence, no dashes; FRONTEND_GUIDE §5.3, §5.4).
 */

const RULES: PolicySettings = {
  grace_minutes: 10,
  office_geofence_mode: "warn",
  home_geofence_mode: "warn",
  site_geofence_mode: "warn",
  device_mode: "warn",
  max_accuracy_m: 100,
  home_radius_m: 100,
};
const MODES: PolicyMode[] = ["off", "warn", "block"];
/** Words as the copy gate counts them: tokens that contain a letter. */
const words = (s: string) => s.split(/\s+/).filter((t) => /[a-z]/i.test(t)).length;
const sentencesOf = (s: PolicySettings) => policySentences(s).flatMap((sec) => sec.sentences);

describe("the policy in sentences", () => {
  it("fills in the values People set, so a changed value changes the sentence", () => {
    const text = sentencesOf({ ...RULES, grace_minutes: 15, home_radius_m: 150, max_accuracy_m: 80 }).join(" ");
    expect(text).toContain("a grace period of 15 minutes after your resumption time");
    expect(text).toContain("more than 150 m from your approved home");
    expect(text).toContain("accurate to within 80 m");
    expect(sentencesOf({ ...RULES, grace_minutes: 1 })[0]).toContain("a grace period of 1 minute after");
    expect(sentencesOf({ ...RULES, grace_minutes: 0 })[0]).toBe("There is no grace period. A clock-in after your resumption time counts as late.");
  });

  it("says what each mode does at each place", () => {
    const at = (mode: PolicyMode) => sentencesOf({ ...RULES, office_geofence_mode: mode, home_geofence_mode: mode, site_geofence_mode: mode, device_mode: mode }).join(" ");
    expect(at("off")).toContain("Nothing is flagged.");
    expect(at("off")).not.toContain("cannot be confirmed");
    expect(at("warn")).toContain("is accepted and sent to People for review.");
    expect(at("warn")).toContain("Until People approve your home, your clock-ins are sent for review.");
    expect(at("block")).toContain("is refused. Clock in again from inside it.");
    expect(at("block")).toContain("is refused. Register it first.");
  });

  it("keeps every sentence within 20 words and free of dashes, whatever the modes", () => {
    for (const mode of MODES) {
      for (const s of sentencesOf({ ...RULES, office_geofence_mode: mode, home_geofence_mode: mode, site_geofence_mode: mode, device_mode: mode, grace_minutes: 59 })) {
        for (const sentence of s.split(/(?<=\.)\s+/)) expect(words(sentence)).toBeLessThanOrEqual(20);
        expect(s).not.toMatch(/—|–|--/);
      }
    }
  });

  it("tags the sections a version changed, and only those", () => {
    const tagged = policySentences(RULES, ["home_radius_m", "device_mode"]).filter((s) => s.changed).map((s) => s.title);
    expect(tagged).toEqual(["Working From Home", "Your Devices"]);
    expect(POLICY_SECTIONS.flatMap((s) => s.rules).sort()).toEqual(
      ["device_mode", "grace_minutes", "home_geofence_mode", "home_radius_m", "max_accuracy_m", "office_geofence_mode", "site_geofence_mode"],
    );
  });

  it("reads a rule's value as a person does", () => {
    expect(ruleValue("grace_minutes", RULES)).toBe("10 minutes");
    expect(ruleValue("office_geofence_mode", { ...RULES, office_geofence_mode: "block" })).toBe("Block");
    expect(ruleValue("home_radius_m", RULES)).toBe("100 m");
  });
});
