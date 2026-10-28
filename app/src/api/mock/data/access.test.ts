import { describe, expect, it } from "vitest";
import { CAPABILITIES, capabilitiesOf, ROLE_CAPABILITIES } from "./access";

const GOALS = ["goals.company", "goals.confirm", "goals.function", "goals.organisation", "goals.view_all"];
const EVERY = ["alerts.clear", "alerts.manage", "announcements.post", ...GOALS, "home.reports", "home.team", "mailbox.signature", "performance.manage", "policies.manage", "queries.configure", "workspace.late_reasons"];

describe("mock capabilities", () => {
  it("the catalogue is the seeded one, A to Z", () => {
    expect(CAPABILITIES.map((c) => c.code)).toEqual(EVERY);
  });

  it("each role holds what the reference seeds give it", () => {
    expect(capabilitiesOf(["implementation"], false)).toEqual(EVERY);
    expect(capabilitiesOf(["operations_people"], false)).toEqual(["alerts.clear", "alerts.manage", "announcements.post", "goals.company", "goals.function", "goals.organisation", "goals.view_all", "home.reports", "home.team", "performance.manage", "policies.manage", "queries.configure", "workspace.late_reasons"]);
    expect(capabilitiesOf(["management"], false)).toEqual(["alerts.clear", "alerts.manage", "announcements.post", "goals.company", "goals.function", "goals.view_all", "home.reports", "home.team", "workspace.late_reasons"]);
    expect(capabilitiesOf(["head_of_department"], false)).toEqual(["alerts.clear", "goals.function", "home.reports", "home.team"]);
    expect(capabilitiesOf(["manager"], false)).toEqual(["alerts.clear", "home.reports", "home.team"]);
    expect(capabilitiesOf(["administrator"], false)).toEqual(["mailbox.signature"]);
    for (const role of ["employee", "unknown"]) expect(capabilitiesOf([role], false)).toEqual([]);
    expect(Object.keys(ROLE_CAPABILITIES)).toHaveLength(7);
  });

  it("everyone in General Management holds the plan's three without a role (the API's CEO-department rule)", () => {
    expect(capabilitiesOf(["employee"], false, true)).toEqual(["goals.company", "goals.organisation", "goals.view_all"]);
    expect(capabilitiesOf(["manager"], false, true)).toEqual(["alerts.clear", "goals.company", "goals.organisation", "goals.view_all", "home.reports", "home.team"]);
    expect(capabilitiesOf(["employee"], false, false)).toEqual([]);
  });

  it("roles add up, and the CEO holds every capability whatever the role", () => {
    expect(capabilitiesOf(["administrator", "manager"], false)).toEqual(["alerts.clear", "home.reports", "home.team", "mailbox.signature"]);
    expect(capabilitiesOf(["employee"], true)).toEqual(EVERY);
  });
});
