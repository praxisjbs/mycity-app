/**
 * Sample navigation for the Shell group's tests and gallery pages: the staff
 * app's modules as a person with Operations grants sees them. Not exported
 * from the package; the app builds its own from the module catalogue.
 */
import type { BottomBarItem } from "./BottomBar";
import type { LauncherGroup } from "./MoreSheet";
import type { PaletteResult } from "./CommandPalette";
import type { RailItem } from "./Rail";

export const RAIL_ITEMS: RailItem[] = [
  { key: "home", label: "Home", icon: "home", href: "#/Rail" },
  { key: "workspace", label: "My Workspace", icon: "check", href: "#/Rail", count: 4 },
  { key: "ess", label: "Employee Self-Service", icon: "user", href: "#/Rail" },
  { key: "community", label: "Staff Community", icon: "msg", href: "#/Rail", group: "Work", count: 3 },
  { key: "mailbox", label: "Mailbox", icon: "mail", href: "#/Rail", group: "Work", count: 12 },
  { key: "people", label: "People", icon: "users", href: "#/Rail", group: "People" },
  { key: "recruitment", label: "Recruitment", icon: "brief", href: "#/Rail", group: "People", count: 12 },
  { key: "expenses", label: "Expenses", icon: "wallet", href: "#/Rail", group: "Business", count: 5 },
  { key: "settings", label: "Settings", icon: "cog", href: "#/Rail", group: "System" },
];

export const BOTTOM_ITEMS = (openMore: () => void, expanded = false): BottomBarItem[] => [
  { key: "home", label: "Home", icon: "home", href: "#/BottomBar" },
  { key: "workspace", label: "Workspace", icon: "check", href: "#/BottomBar", count: 4 },
  { key: "community", label: "Community", icon: "msg", href: "#/BottomBar", count: 3 },
  { key: "ess", label: "Self-Service", icon: "user", href: "#/BottomBar" },
  { key: "more", label: "More", icon: "grid", onSelect: openMore, expanded },
];

export const MORE_GROUPS: LauncherGroup[] = [
  {
    label: "Work",
    tiles: [
      { key: "community", label: "Community", icon: "msg", href: "#/MoreSheet", count: 3 },
      { key: "mailbox", label: "Mailbox", icon: "mail", href: "#/MoreSheet", count: 12 },
    ],
  },
  {
    label: "People",
    tiles: [
      { key: "people", label: "People", icon: "users", href: "#/MoreSheet" },
      { key: "performance", label: "Performance", icon: "target", href: "#/MoreSheet" },
      { key: "queries", label: "Queries", icon: "flag", href: "#/MoreSheet", count: 2 },
      { key: "recruitment", label: "Recruitment", icon: "brief", href: "#/MoreSheet", count: 12 },
      { key: "payroll", label: "Payroll", icon: "wallet", href: "#/MoreSheet" },
    ],
  },
  {
    label: "Business",
    tiles: [
      { key: "partnerships", label: "Partners", icon: "link", href: "#/MoreSheet" },
      { key: "expenses", label: "Expenses", icon: "wallet", href: "#/MoreSheet", count: 5 },
    ],
  },
  {
    label: "System",
    tiles: [
      { key: "knowledge", label: "Knowledge", icon: "book", href: "#/MoreSheet" },
      { key: "praxis_ai", label: "Praxis", icon: "spark", href: "#/MoreSheet" },
      { key: "settings", label: "Settings", icon: "cog", href: "#/MoreSheet" },
    ],
  },
];

export const PALETTE_RESULTS: PaletteResult[] = [
  { key: "s1", group: "Screens", title: "Leave", subtitle: "People", href: "#/CommandPalette" },
  { key: "s2", group: "Screens", title: "My Leave", subtitle: "Self-Service", href: "#/CommandPalette" },
  { key: "p1", group: "People", title: "Adaeze Okonkwo", subtitle: "Content Producer", icon: "user", href: "#/CommandPalette" },
  { key: "p2", group: "People", title: "Bashir Lawal", subtitle: "Field Officer", icon: "user", href: "#/CommandPalette" },
];
