import { describe, expect, it } from "vitest";
import type { Me } from "@/api/types/identity";
import { createActionsFor } from "./createActions";

/** Home's New (docs/guides/home.md §6 Overview): only what the reader holds, on screens they may open that are open. */

const ALL = ["view", "create", "edit", "delete", "approve", "export"] as const;

function person(over: Partial<Me> = {}): Me {
  return {
    user_id: "00000000-0000-4000-a000-000000000001",
    employee_id: "00000000-0000-4000-a000-000000000002",
    email: "someone@mycityapp.io",
    display_name: "Some One",
    first_name: "Some",
    job_title: "Associate",
    department: "Content",
    photo_url: null,
    is_ceo: false,
    grants: { home: ["view"], workspace: ["view", "create"], ess: ["view", "create"] },
    capabilities: [],
    roles: [{ code: "employee", name: "Staff" }],
    home_view: "staff",
    manages_people: false,
    ...over,
  } as Me;
}

const everyScreen = () => true;
const labels = (me: Me, opens: (m: string, t: string) => boolean = everyScreen) => createActionsFor(me, opens).map((a) => a.label);

describe("Home's New", () => {
  it("offers a member of staff what they may create: a task, a leave request and a work site", () => {
    expect(labels(person())).toEqual(["New Task", "Request Leave", "Add Work Site"]);
  });

  it("adds New Rule and New Report for the holders of their capabilities, in that order", () => {
    const manager = person({ capabilities: ["alerts.manage", "home.reports"] });
    expect(labels(manager)).toEqual(["New Task", "Request Leave", "Add Work Site", "New Rule", "New Report"]);
  });

  it("gives the CEO every action, as every capability check passes them", () => {
    const ceo = person({ is_ceo: true, grants: Object.fromEntries(["home", "workspace", "ess"].map((m) => [m, [...ALL]])) as Me["grants"] });
    expect(labels(ceo)).toEqual(["New Task", "Request Leave", "Add Work Site", "New Rule", "New Report"]);
  });

  it("leaves out an action without its grant", () => {
    expect(labels(person({ grants: { home: ["view"], workspace: ["view"], ess: ["view", "create"] } }))).toEqual(["Request Leave", "Add Work Site"]);
  });

  it("leaves out an action whose screen the reader may not open, though they hold its capability", () => {
    // alerts.manage without the tab: Alerts opens for alerts.clear or alerts.manage, Reports for home.reports.
    const noHome = person({ grants: { workspace: ["view", "create"], ess: ["view", "create"] }, capabilities: ["alerts.manage", "home.reports"] });
    expect(labels(noHome)).toEqual(["New Task", "Request Leave"]);
  });

  it("leaves out an action whose screen is not open in this build yet (Coming Soon)", () => {
    const manager = person({ capabilities: ["alerts.manage", "home.reports"] });
    expect(labels(manager, (module, tab) => !(module === "workspace" && tab === "tasks") && tab !== "reports")).toEqual(["Request Leave", "Add Work Site", "New Rule"]);
  });

  it("opens each action on the screen that owns it, already asked to start", () => {
    const manager = person({ capabilities: ["alerts.manage", "home.reports"] });
    expect(createActionsFor(manager, everyScreen).map((a) => a.href)).toEqual([
      "/workspace?tab=tasks&new=1",
      "/ess?tab=my-leave&action=new",
      "/home?tab=overview&action=work-site",
      "/home?tab=alerts&action=new",
      "/home?tab=reports&action=new",
    ]);
  });
});
