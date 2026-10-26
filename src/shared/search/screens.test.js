"use strict";
/**
 * tabVisible mirrors the shell (app/src/shell/access.ts visibleTabs): search, the User Guide and
 * the assistant offer a tab only to a reader the shell shows it to.
 */
const { tabVisible } = require("./screens");

const reader = (grants, extra = {}) => ({ grants, capabilities: [], is_ceo: false, manages_people: false, ...extra });
const people = (tab) => ({ module: "people", tab });

describe("People's tabs for a reader without Settings", () => {
  test("a line manager may open Leave, to decide their team's leave, beside Attendance and Organogram", () => {
    const manager = reader({ people: ["view", "approve"] }, { manages_people: true });
    expect(["attendance", "organogram", "leave"].every((tab) => tabVisible(people(tab), manager))).toBe(true);
    expect(tabVisible(people("employees"), manager)).toBe(false);
  });

  test("anyone else sees Attendance and Organogram only", () => {
    const staff = reader({ people: ["view"] });
    expect(tabVisible(people("leave"), staff)).toBe(false);
    expect(tabVisible(people("attendance"), staff)).toBe(true);
  });

  test("Operations, with Settings, sees every People tab", () => {
    const ops = reader({ people: ["view", "create"], settings: ["view"] });
    expect(["employees", "leave", "devices", "worksites"].every((tab) => tabVisible(people(tab), ops))).toBe(true);
  });
});

describe("Staff Community's Announcements", () => {
  const announcements = { module: "community", tab: "announcements" };
  test("follows announcements.post, as every announcements route asks, not People create", () => {
    expect(tabVisible(announcements, reader({ community: ["view"] }, { capabilities: ["announcements.post"] }))).toBe(true);
    expect(tabVisible(announcements, reader({ community: ["view"], people: ["view", "create"] }))).toBe(false);
    expect(tabVisible(announcements, reader({ community: ["view"] }, { is_ceo: true }))).toBe(true);
  });
});
