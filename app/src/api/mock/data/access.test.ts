import { describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesOf, ROLE_CAPABILITIES } from "./access";

const HOME = ["alerts.clear", "alerts.manage", "announcements.post", "home.reports", "home.team"];
const EVERY = [...HOME, "mailbox.signature", "policies.manage"];

describe("mock capabilities", () => {
  it("the catalogue is the seeded one, A to Z", () => {
    expect(CAPABILITIES.map((c) => c.code)).toEqual(EVERY);
  });

  it("each role holds what the reference seeds give it", () => {
    expect(capabilitiesOf(["implementation"], false)).toEqual(EVERY);
    expect(capabilitiesOf(["operations_people"], false)).toEqual([...HOME, "policies.manage"]);
    expect(capabilitiesOf(["management"], false)).toEqual(HOME);
    for (const role of ["head_of_department", "manager"]) expect(capabilitiesOf([role], false)).toEqual(["alerts.clear", "home.reports", "home.team"]);
    expect(capabilitiesOf(["administrator"], false)).toEqual(["mailbox.signature"]);
    for (const role of ["employee", "unknown"]) expect(capabilitiesOf([role], false)).toEqual([]);
    expect(Object.keys(ROLE_CAPABILITIES)).toHaveLength(7);
  });

  it("roles add up, and the CEO holds every capability whatever the role", () => {
    expect(capabilitiesOf(["administrator", "manager"], false)).toEqual(["alerts.clear", "home.reports", "home.team", "mailbox.signature"]);
    expect(capabilitiesOf(["employee"], true)).toEqual(EVERY);
  });
});
