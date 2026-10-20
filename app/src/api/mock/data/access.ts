/**
 * Capabilities as the reference seeds give them (README §5.2): what Settings · Roles &
 * Permissions offers, and which role holds which until someone changes it there. The
 * identity mock reads a person's from here and the settings mock a role's, so /me and
 * the Roles screen agree. Codes A to Z, as the API lists them.
 */
export const CAPABILITIES = [
  { code: "alerts.clear", name: "Clear Alerts", description: "Clear or dismiss an alert on Home." },
  { code: "alerts.manage", name: "Manage Alert Rules", description: "Create, change and switch off the rules that raise alerts on Home." },
  { code: "announcements.post", name: "Post Announcements", description: "Post to the announcements channel and track who has read a post." },
  { code: "home.reports", name: "Run Reports", description: "Build, schedule and run reports on Home, and receive them." },
  { code: "home.team", name: "View Team", description: "Open the Team tab on Home: who is in today and the team's figures." },
  { code: "mailbox.signature", name: "Configure Signature", description: "Set the company's signature links and what shows on everyone's email signature." },
  { code: "policies.manage", name: "Manage Policies", description: "Write, publish, withdraw and archive company policies, and see who has acknowledged them." },
];

const EVERY = CAPABILITIES.map((c) => c.code);
const HOME = ["alerts.clear", "alerts.manage", "announcements.post", "home.reports", "home.team"];
const MANAGES = ["alerts.clear", "home.reports", "home.team"];

/** Role code → the capabilities it holds by default. */
export const ROLE_CAPABILITIES: Record<string, string[]> = {
  implementation: EVERY,
  operations_people: [...HOME, "policies.manage"],
  management: HOME,
  head_of_department: MANAGES,
  manager: MANAGES,
  administrator: ["mailbox.signature"],
  employee: [],
};

/** What a person holds: every capability for the CEO, else the union of their roles'. */
export function capabilitiesOf(roleCodes: string[], isCeo: boolean): string[] {
  if (isCeo) return [...EVERY];
  return EVERY.filter((code) => roleCodes.some((r) => ROLE_CAPABILITIES[r]?.includes(code)));
}
