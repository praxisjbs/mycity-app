import { describe, expect, it } from "vitest";
import type { Me } from "@/api/types/identity";
import { MODULES } from "./catalogue";
import { hasCapability, visibleModules, visibleTabs } from "./access";

const home = MODULES.find((m) => m.key === "home")!;
const people = MODULES.find((m) => m.key === "people")!;

function person(capabilities: string[], over: Partial<Me> = {}): Me {
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    employee_id: "00000000-0000-4000-8000-000000000002",
    email: "ada@mycityapp.io",
    display_name: "Ada Obi",
    first_name: "Ada",
    job_title: "Content Associate",
    department: "Content",
    photo_url: null,
    is_ceo: false,
    grants: { home: ["view"], people: ["view"] },
    capabilities,
    roles: [{ code: "employee", name: "Staff" }],
    home_view: "staff",
    manages_people: false,
    ...over,
  };
}

const tabs = (me: Me) => visibleTabs(me, home).map((t) => t.slug);

describe("shell access", () => {
  it("a capability is held when /me lists it, and the CEO holds every one", () => {
    expect(hasCapability(person(["home.team"]), "home.team")).toBe(true);
    expect(hasCapability(person(["home.team"]), "home.reports")).toBe(false);
    expect(hasCapability(person([], { is_ceo: true }), "alerts.manage")).toBe(true);
  });

  it("Home's Team, Alerts and Reports follow capabilities, not managing people or Settings", () => {
    expect(tabs(person([]))).toEqual(["overview"]);
    expect(tabs(person([], { manages_people: true, grants: { home: ["view"], settings: ["view"] } }))).toEqual(["overview"]);
    expect(tabs(person(["home.team"]))).toEqual(["overview", "team"]);
    expect(tabs(person(["home.reports"]))).toEqual(["overview", "reports"]);
    expect(tabs(person(["alerts.clear"]))).toEqual(["overview", "alerts"]);
    expect(tabs(person(["alerts.manage"]))).toEqual(["overview", "alerts"]);
    expect(tabs(person([], { is_ceo: true }))).toEqual(["overview", "team", "alerts", "reports"]);
  });

  it("a capability opens a tab, never a module the person cannot view", () => {
    const me = person(["home.team"], { grants: { people: ["view"] } });
    expect(visibleModules(me).map((m) => m.key)).toEqual(["people"]);
  });

  it("every other module's tabs are gated as before", () => {
    expect(visibleTabs(person(["home.team"]), people).map((t) => t.slug)).toEqual(["organogram", "attendance"]);
    expect(visibleTabs(person([], { is_ceo: true }), people)).toHaveLength(people.tabs.length);
  });
});
