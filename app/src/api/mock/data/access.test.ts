import { describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesOf, ROLE_CAPABILITIES } from "./access";

const EVERY = ["alerts.clear", "alerts.manage", "announcements.post", "home.reports", "home.team"];

describe("mock capabilities", () => {
  it("the catalogue is the seeded one, A to Z", () => {
    expect(CAPABILITIES.map((c) => c.code)).toEqual(EVERY);
  });

  it("each role holds what the reference seeds give it", () => {
    for (const role of ["implementation", "operations_people", "management"]) expect(capabilitiesOf([role], false)).toEqual(EVERY);
    for (const role of ["head_of_department", "manager"]) expect(capabilitiesOf([role], false)).toEqual(["alerts.clear", "home.reports", "home.team"]);
    for (const role of ["administrator", "employee", "unknown"]) expect(capabilitiesOf([role], false)).toEqual([]);
    expect(Object.keys(ROLE_CAPABILITIES)).toHaveLength(7);
  });

  it("roles add up, and the CEO holds every capability whatever the role", () => {
    expect(capabilitiesOf(["administrator", "manager"], false)).toEqual(["alerts.clear", "home.reports", "home.team"]);
    expect(capabilitiesOf(["employee"], true)).toEqual(EVERY);
  });
});
