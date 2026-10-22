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

## Milestone 1 handover pack · `M1-handover/` · 22 October 2026

Client documents for the Milestone 1 sign-off, from the handover meeting of 21 October 2026.

| File | What it is |
| --- | --- |
| `MyCity-ERP_M1-Handover-and-Signoff.html` | Cover, the two-page sign-off sheet (completion against Annexure A, work built ahead, the points raised and how each closed, acceptance) and the attendance register. 4 pages |
| `MyCity-ERP_Change-Report-01_Mailbox.html` | Change Report 01 for the Mailbox, ₦250,000 one-off, with MyCity's choice to keep it or have it switched off at no charge. 4 pages |
| `MyCity-ERP_Invoice-002_Milestone-1.html` | Invoice 002, Milestone 1, ₦384,000, due seven working days after acceptance. 1 page |
| `MyCity-ERP_Invoice-003_Change-Order-01.html` | Invoice 003, Change Order 01, ₦250,000, payable only if Change Report 01 is approved. 1 page |
| `MyCity-ERP_Integrations-and-Running-Costs.html` | Every integration and its cost, the Namecheap upgrade to Stellar Business, and moving AI to MyCity's own accounts. 3 pages |

Each is one self-contained file that works offline, fonts and PDF engine included. The bar at the
top: **Edit** makes any text editable; **Details** changes a value everywhere it appears (amounts
recalculate totals and the amount in words); **Save Copy** downloads the file with the changes;
**Download PDF** exports A4 pages; **Print** gives a vector PDF through the browser's Save as PDF.
A page whose text runs past A4 is outlined in red and the PDF waits until it fits.

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
