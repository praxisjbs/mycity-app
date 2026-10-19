# Engineering guides

One guide per feature. A guide says, before the code exists, **every screen the feature touches,
how those screens relate, and what each must do**, so that what was planned is what gets built,
nothing drifts, and no screen is left half done. It is read before building and updated before
changing behaviour: **a change to a feature passes through its guide first.**

**Guides are full-stack.** One guide covers the feature's backend modules, data, schemas, API,
events, permissions, AI reads and screens (§4 to §10). A frontend builder reads the whole guide, not
only §10, and a backend builder reads §10 too. The header's **Frontend paths** row names the
feature's own folders (`app/src/features/<module>/`, `public-app/src/pages/...`); shared components
live in `packages/ui` (`docs/COMPONENTS.md`) and are never a feature path. Its **Capabilities** row
names each authority the feature needs beyond its permission key's six actions, or `none`; README
§5.2 is the rule every module follows.

Start a new guide by copying `_TEMPLATE.md` to `<module>.md` (the backend module name, e.g.
`attendance.md`). Keep it current: a guide that describes last month's behaviour is worse than none.

**A guide is not screen copy.** Its rules (§3, §6) are written for engineers. What a person sees is
decided in **§10 On screen and mobile**: per screen, what is open, what sits behind a help term or a
Details row, what never reaches a screen and where it lives instead, and the phone layout
(FRONTEND_GUIDE §5, §7). A sentence in §6 that turns up as a card on a screen is the bug this
section exists to stop.

| Guide | Feature | Owner | Milestone | Written |
|---|---|---|---|---|
| `home.md` | Home: Overview, Team, Alerts, Reports (role-sensitive dashboard, KPI catalogue, alert rules, scheduled reports) | TB | M1 | ☑ |
| `attendance.md` | Clock-in and clock-out across ESS, People, Settings and Devices | LA | M1 | ☐ |
| `ess.md` | Employee Self-Service: the seven approved tabs plus My Security; the attendance tabs inside ESS are LA's | AJ | M1 | ☐ |
| `community.md` | Staff Community: Channels, Direct Messages, Announcements, recognition, celebrations | GE | M1 | ☑ |
| `mailbox.md` | Mailbox client | GE | M1 | ☑ |
| `identity.md` | Sign-in, sessions and the lock screen, credential links, My Security (password and sessions), Settings · Users | TB | M0 | ☑ |
| `foundation.md` | Foundation completion: People · Employees and the staff roster, imports, documents, roles and permissions, settings, audit, approvals, ⌘K search, in four tracks | TB | M0 | ☑ |
| `organogram.md` | Organogram: People · Organogram (HR builder) and ESS · Org Chart (read-only viewer) over the live reporting tree | TB | M1 | ☐ |
| `queries.md` | Queries & Sanctions: Queries, Rules, Sanctions and the consequence chain, Letter Templates; the employee's side in ESS · My Queries | GE | M3 | ☐ |
| `notifications.md` | Notifications: the bell's pane on both shells, the in-app banner, web push to phones and computers, Notification Settings (brought forward from M6) | TB | M0 | ☐ |

Tick **Written** when the guide exists and has been read by the owner of every screen in its §2.
Later milestones add their rows as they start.
