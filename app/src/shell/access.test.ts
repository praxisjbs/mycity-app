import { describe, expect, it } from "vitest";
import type { Me } from "@/api/types/identity";
import { MODULES } from "./catalogue";
import { hasCapability, visibleModules, visibleTabs } from "./access";

const home = MODULES.find((m) => m.key === "home")!;
const people = MODULES.find((m) => m.key === "people")!;
const settings = MODULES.find((m) => m.key === "settings")!;

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
    appearance: { dark: null, fonts: { heading: "geist", body: "geist" }, theme_default: "system", density_default: "compact" },
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

  it("Home keeps its four tabs for every Home viewer, whatever capabilities they hold: a tab they cannot use shows locked", () => {
    const all = ["overview", "team", "alerts", "reports"];
    expect(tabs(person([]))).toEqual(all);
    expect(tabs(person(["home.team"]))).toEqual(all);
    expect(tabs(person(["alerts.manage"]))).toEqual(all);
    expect(tabs(person([], { is_ceo: true }))).toEqual(all);
  });

  it("Settings shows Integrations only to integrations viewers and the CEO", () => {
    const settings = MODULES.find((m) => m.key === "settings")!;
    const has = (me: Me) => visibleTabs(me, settings).some((t) => t.slug === "integrations");
    expect(has(person([], { grants: { settings: ["view"] } }))).toBe(false);
    expect(has(person([], { grants: { settings: ["view"], integrations: ["view"] } }))).toBe(true);
    expect(has(person([], { grants: { settings: ["view"] }, is_ceo: true }))).toBe(true);
    // Integrations alone still reaches Settings, and only its own tab, so its notices land.
    const itOnly = person([], { grants: { integrations: ["view"] } });
    expect(visibleModules(itOnly).map((m) => m.key)).toEqual(["settings"]);
    expect(visibleTabs(itOnly, settings).map((t) => t.slug)).toEqual(["integrations"]);
  });

  it("a capability never opens a module the person cannot view", () => {
    const me = person(["home.team"], { grants: { people: ["view"] } });
    expect(visibleModules(me).map((m) => m.key)).toEqual(["people"]);
  });

  it("every other module's tabs are gated as before", () => {
    expect(visibleTabs(person(["home.team"]), people).map((t) => t.slug)).toEqual(["organogram", "attendance"]);
    expect(visibleTabs(person([], { is_ceo: true }), people)).toHaveLength(people.tabs.length);
  });

  it("Status, Performance and Faults follow System Health, not Settings, so a notice always lands", () => {
    const health = ["status", "performance", "faults"];
    // Operations & People hold Settings but not System Health: the three tabs are not theirs.
    const ops = person([], { grants: { settings: ["view", "edit"] } });
    expect(visibleTabs(ops, settings).map((t) => t.slug).filter((s) => health.includes(s))).toEqual([]);
    expect(visibleTabs(ops, settings).map((t) => t.slug)).toContain("users");
    // The System Administrator holds all three: every tab.
    const admin = person([], { grants: { settings: ["view"], system_health: ["view", "edit"], integrations: ["view", "edit", "delete"] } });
    expect(visibleTabs(admin, settings)).toHaveLength(settings.tabs.length);
    // A person who holds System Health alone still reaches Settings, and sees only its three tabs.
    const healthOnly = person([], { grants: { system_health: ["view"] } });
    expect(visibleModules(healthOnly).map((m) => m.key)).toEqual(["settings"]);
    expect(visibleTabs(healthOnly, settings).map((t) => t.slug)).toEqual(health);
    // The CEO passes every check.
    expect(visibleTabs(person([], { is_ceo: true, grants: {} }), settings)).toHaveLength(settings.tabs.length);
  });
});
