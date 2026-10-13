# Engineering guides

One guide per feature. A guide says, before the code exists, **every screen the feature touches,
how those screens relate, and what each must do**, so that what was planned is what gets built,
nothing drifts, and no screen is left half done. It is read before building and updated before
changing behaviour: **a change to a feature passes through its guide first.**

Start a new guide by copying `_TEMPLATE.md` to `<module>.md` (the backend module name, e.g.
`attendance.md`). Keep it current: a guide that describes last month's behaviour is worse than none.

| Guide | Feature | Owner | Milestone | Written |
|---|---|---|---|---|
| `home.md` | Home: Overview, Alerts, Reports (dashboard, KPI catalogue, alert rules, scheduled reports) | TB | M1 | ☐ |
| `attendance.md` | Clock-in and clock-out across ESS, People, Settings and Devices | LA | M1 | ☐ |
| `ess.md` | Employee Self-Service, all seven tabs | AJ | M1 | ☐ |
| `community.md` | Staff Community: Channels, Direct Messages, Announcements, recognition, celebrations | GE | M1 | ☑ |
| `mailbox.md` | Mailbox client | GE | M1 | ☑ |

Tick **Written** when the guide exists and has been read by the owner of every screen in its §2.
Later milestones add their rows as they start.
