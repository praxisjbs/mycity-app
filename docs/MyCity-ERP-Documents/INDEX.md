# MyCity App ERP — document pack

Prepared by [JBS Praxis](https://jbspraxis.com). Six files, 12 October 2026.

| File | What it is | How to open |
| --- | --- | --- |
| `MILESTONES.md` | The technical milestone document. Architecture decisions A1 to A26, environment topology, twenty engineering gates, the schedule, and Milestone 0 through Milestone 11 in detail. About 16 pages. | Any markdown reader, or a text editor |
| `REUSE_MAP.md` | The reuse audit. A file-level account of what each milestone takes from the two donor codebases, with the revised percentages after the 10 October meeting. About 10 pages. | Any markdown reader, or a text editor |
| `MILESTONE_QUESTIONS.md` | The fifteen questions put before the technical document was written, each with a recommendation and the answer given. | Any markdown reader, or a text editor |
| `milestones.html` | The twelve-page presentation deck. Brand aware, with the Gantt, the reuse chart and the architecture diagram. | Double click. Opens in any browser |
| `demo.html` | The clickable prototype. Fifteen modules, seventy-nine tabs, the six-page public site, two record 360s. Light and dark. | Double click. Opens in any browser |
| `EMAIL-naming-approval.md` | The naming approval section to paste into the requirements email to Cynthia. Not a client document on its own. | Any markdown reader, or a text editor |
| `letter-samples/` | MyCity's six disciplinary letters (query, attendance query, caution, warning, suspension, dismissal), redacted: names, dates and offences are placeholders. Added 27 October 2026 for M3's letter templates. | Any markdown reader, or a text editor |

## Opening the two HTML files

Both are single self-contained files. Double click and they open in a browser.
No server, no install, no internet connection needed except for the typeface,
which falls back cleanly if you are offline.

`demo.html` opens on a sign-in screen with the credentials already filled in.
Press **Sign in**. The moon icon in the top bar switches between light and dark.
**⌘K** (or **Ctrl+K**) opens search. In People and in Partnerships, clicking a
row opens that record's 360.

## Naming

The fifteen modules and eighty-five screens are named consistently across the prototype,
`MILESTONES.md` §18 and the deck's final slide. The three lists were generated from the
prototype, so they cannot drift apart. **Approved 12 October 2026.**

`EMAIL-naming-approval.md` is the section that tells MyCity what everything is called and
invites a correction by 16 October. `REUSE_MAP.md` is an internal engineering audit of the
donor codebases and refers to modules by milestone rather than by name.

## The public site is not part of the app

Six of the eighty-five screens — Careers, Vacancy, Apply, Assessment, Sign Offer and Verify
Document — are a **separate application on a separate origin**, `go.mycityapp.io`. The staff
application is `hub.mycityapp.io`. A different origin shares no cookie, no storage and no
service worker with the staff app, so a job link or a signing link never touches it.

In `demo.html` these six appear under a rail group marked **Separate app**, with a banner on
each. That is a demo affordance so you can see them. In the built product nothing in the rail
links there, and no member of staff navigates to it.
