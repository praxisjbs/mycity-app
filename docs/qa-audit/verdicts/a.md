# Group a · Partnerships (CRM) · verdict blocks (written as each finding is settled)

```
ID: F05
Title: Partner and lead Work tab failed with a server error
Verdict: FIXED_SINCE_AUDIT
Severity: High
Module: Partnerships
Evidence: Commit 4978ae8 (17/11/2026), src/modules/partners/partners.work.js:238-239: a reader with company-wide (`all`) Workspace scope pushed a query parameter the task SQL never used, so PostgreSQL refused the query; the hidden-count loop (partners.work.js:324-331) runs that task filter for every kind, which is why tasks, projects and events all failed. tests/integration/partnerships-work.test.js:255 "the Work tab opens every kind for a reader of every scope (all, team, own)" reads task, project and event as `ops` (operations_people, workspace `all`, the same scope as Management, seeds/reference/0290_seed_roles_and_grants.sql:46,62), a manager and an employee; the lead ran the file 13/13 green on HEAD. The test asks by lead_id; partner_id goes through the same list() and visibleOf() (partners.work.js:302-331), so the partner path is the same code. A task made from the tab (TSK-0115) was saved; it only failed to list because of the same error.
Scope ref: MILESTONES §12 (Partnership 360); docs/guides/partnerships.md §6.16, Appendix A PR 5
Fix: None (done). Optionally add a partner_id case to the same test.
Effort: S
For MyCity: The Work tab error was a fault in how the list was asked for when the reader can see all work. It was fixed on 17/11 and is covered by an automated test for every kind and every level of access.
```

```
ID: F22
Title: Lead source now required on the first step
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8. packages/contract/schemas/leads.js: LeadFields.source is now required (node check: no source gives "Required", an empty source is refused, "Referral" passes); LeadAdd.source required too. app/src/features/partnerships/forms/parts.tsx: Source moved out of Advanced onto the Organisation step for leads (ComboField, typed or picked from MyCity's list). Integration fixtures now send a source (partnerships-records and -work pass, 64/64 and 13/13). Leads made before 17/11 keep "No Source" until edited.
Scope ref: docs/guides/partnerships.md §10.1 (New Lead: "Source on a lead, required"), §13.2 entry 17/11/2026
Fix: None in code. On staging, old leads with no source can be given one with Edit Lead.
Effort: S
For MyCity: Source is now a required field on the first step of New Lead, so the Leads by Source report fills as new leads are added. Leads entered before 17/11 can be given a source with Edit Lead.
```

```
ID: F24
Title: Partner screen cramped beside its list
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 3945405 (#165), merged 16/11/2026 18:49, during the audit window; the auditor describes the earlier side panel, so their staging build predated it. Partners, Leads, Proposals, Contracts & MOUs and Categories now show the list full width and open a record as its own page at ?id= (app/src/features/partnerships/Partners.tsx:14-28, RecordPage with Back to Partners); filters sit in one row (filters.tsx); StageSwitcher became a seven-step bar with the stage named, Next Stage and Change Stage, replacing the 13+ wrapping stage buttons. app/src/features/partnerships/screens.test.tsx passes 23/23 on HEAD.
Scope ref: docs/guides/partnerships.md §10 (F31 amended 16/11/2026, TB), §13.2 entry 16/11/2026
Fix: None.
Effort: S
For MyCity: This was changed on 16/11 after your earlier feedback: each partner, lead, proposal and agreement now opens on its own full page, filters sit in one row, and the stage is a compact seven-step bar. Please recheck on staging.
```

```
ID: F25a
Title: Same reference list requested many times on one partner
Verdict: FIXED_SINCE_AUDIT
Severity: Low
Module: Platform (packages/ui API client)
Evidence: Commit 4978ae8, packages/ui/src/data/createApi.ts:300-320,420: one GET in flight per request key, so parts of a screen mounted together (the 360's stage list, the same deal) share one request; reload and invalidation still ask afresh. The staff app turns the cache on (app/src/api/client.ts:24). packages/ui/src/data/createApi.test.tsx "reads of one thing mounted together share one request, and a reload still asks again" passes (2 files, 25 tests green).
Scope ref: CLAUDE.md "No second copy of a shared concern" (one API client); docs/guides/partnerships.md §13.2 entry 17/11/2026
Fix: None.
Effort: S
For MyCity: Repeated identical requests when opening a partner are now merged into one. Fixed on 17/11.
```

```
ID: F25b
Title: Goals tab asks for unread marks once per objective
Verdict: IMPROVEMENT
Severity: Low
Module: Notifications / Performance (Goals)
Evidence: Not fixed by 4978ae8: its de-duplication only merges identical requests. app/src/features/notifications/marks.tsx:52-60 sends one GET /notifications/unread-records per list on screen (the ids on that list); app/src/features/performance/Goals.tsx:306 renders one DataView per objective card, so a Goals tab with about 25 objectives sends about 25 requests, each with different ids. It only happens while the tab has unread notices (marks.tsx:54). Code reading; no functional error.
Scope ref: docs/guides/notifications.md §6 (a list asks for the ids on its page, at most 25)
Fix: Gather the row ids of every list on the screen and ask once per screen (a small batching provider in marks.tsx, ids capped and paged at 25), or ask once at the Goals card level for all its objectives.
Effort: M
For MyCity: The Goals tab makes one small request per objective to show unread dots. It works correctly but is wasteful; we will log it as a performance improvement.
```

```
ID: F45
Title: Analytics charts lacked units
Verdict: FIXED_SINCE_AUDIT
Severity: Low
Module: Partnerships
Evidence: Commit 4978ae8, app/src/features/partnerships/Analytics.tsx:312-327: Signed per Month bars read "n deals", Returns per Month bars read in naira (formatMoneyShort) and its caption reads "app downloads". The Downloads measure in By Lead Owner already carries its help, "App downloads in the returns of the owner's deals." (Analytics.tsx:90-92, also before the fix), which is the definition the auditor missed.
Scope ref: docs/guides/partnerships.md §10.1 Analytics ("each bar in deals", "each bar in naira, the caption in app downloads", help on each measure), §6.18
Fix: None.
Effort: S
For MyCity: Charts now show their units (deals, naira, app downloads), and every measure in the lead owner table has a short definition behind its help mark.
```

```
ID: F46
Title: Region pre-selected as National on new records
Verdict: FIXED_SINCE_AUDIT
Severity: Low
Module: Partnerships
Evidence: Commit 4978ae8, app/src/features/partnerships/forms/parts.tsx RegionField: the default changed from { scope: "national" } to none; LeadForm.tsx:56 starts with { scope: "" } and the contract refuses an empty scope (node check on leads.LeadFields), so the person must choose. The 13 records seen on staging are the demonstration seed, which gives every record National (seeds/staging/70_partnerships.js:385,436); staging only, never production (A5).
Scope ref: docs/guides/partnerships.md §10.1 ("Region with none chosen"), §6.19 (cities are picked)
Fix: None in the form. Optionally vary the seed's regions so the staging demo reads realistically.
Effort: S
For MyCity: New Lead and New Partner no longer choose a region for you. The records that all read National are our staging demonstration data and do not go to production.
```

```
ID: F49
Title: Proposals subtitle named a third-party AI model
Verdict: FIXED_SINCE_AUDIT
Severity: Low
Module: Partnerships
Evidence: Commit 4978ae8, app/src/features/partnerships/Proposals.tsx:205: the subtitle "Written with Claude, sent by you" is removed; the page header now has no subtitle.
Scope ref: docs/guides/partnerships.md §10.1 Proposals ("no reassurance about AI on screen"), §13.2 entry 17/11/2026
Fix: None.
Effort: S
For MyCity: The subtitle naming the AI model has been removed from Proposals.
```

```
ID: F21a
Title: Lead status and deal stage seen as two status systems
Verdict: BY_DESIGN
Severity: Low
Module: Partnerships
Evidence: A lead's status is not set by anyone: it is read from its deal's stage (New, Contacted, Qualified, Lost, Converted) and kept in step by the service on every stage move; LeadUpdate in packages/contract/schemas/leads.js has no status key. tests/integration/partnerships-records.test.js:307-328 shows the status following the stage (Proposal Sent gives Qualified, back to Initial Contact gives Contacted). The auditor's own note (Contract Review read Qualified, then Converted on signing) is this rule working.
Scope ref: MILESTONES §12 "Amended 05/11/2026": "its status (new, contacted, qualified, lost, converted) is read from that deal's stage"; MILESTONES §12 Leads paragraph; docs/guides/partnerships.md §6.4
Fix: None.
Effort: S
For MyCity: There is one lifecycle: the deal's stage. A lead's status is a short summary of that stage, as MyCity's tracker and the 05/11 decision asked, and cannot drift from it.
```

```
ID: F21b
Title: Thirteen stages, and Active Partnership stage stays empty
Verdict: CLIENT_ACTION
Severity: Low
Module: Partnerships
Evidence: The thirteen stages are MyCity's own tracker dropdown (MILESTONES §12, "Stages, in order: prospect identified ... on hold"); on staging they are demonstration data (seeds/staging/65_partnership_setup.js:26-40) and production starts empty: MyCity enters them on Categories · Pipeline Settings or Start From Tracker (A26). A partner reads Active while any deal is live (docs/guides/partnerships.md §6.6), which is not the same thing as the stage Active Partnership; nothing moves a deal to that stage automatically, a person does. Since 16/11 (3945405) a stage shows as a seven-step bar of what it counts as, so the long list no longer crowds the screen.
Scope ref: MILESTONES §12 (tracker stages; Amended 05/11/2026: stages are MyCity's, never seeded, A26); docs/guides/partnerships.md §6.3, §6.6, §10
Fix: None in code. MyCity decides its stage list on Categories · Pipeline Settings: rename, merge or retire stages (it must keep one stage meaning prospect, signed and closed lost), for example retire Active Partnership if they do not use it.
Effort: S
For MyCity: The stage list is your tracker's, and you own it: you can rename or retire stages yourselves on Categories, Pipeline Settings. "Active" on a partner means it has a live deal; if you do not use the Active Partnership stage, retire it there.
```

```
ID: F08
Title: No customer records, support tickets or marketing campaigns
Verdict: OUT_OF_SCOPE
Severity: Medium
Module: Partnerships (CRM)
Evidence: MILESTONES §12 (M7 "Partnerships, CRM & Trackers") scopes partners, leads from business development, the partnership tracker, proposals, agreements, mail threads and partnership analytics; its Definition of done names only partnership records. No milestone (M0 to M11) mentions app end-user records, a ticket queue or campaign records. The 17/11 decision records it: "The audit's customer, ticket and campaign records (F08) are not scoped: Partnerships is a partner CRM" (docs/guides/partnerships.md §13.2, entry 17/11/2026).
Scope ref: MILESTONES §12 and its Definition of done; docs/guides/partnerships.md §1, §13.2 entry 17/11/2026
Fix: None under contract. A Change Report would need: a customer record (app users linked to transactions and enquiries, with the data source and privacy basis), a support ticket queue (channels, SLAs, assignment, statuses), campaign records and attribution feeding the Branding & Marketing KPIs, plus integrations with the MyCity app's own data.
Effort: L
For MyCity: The hub's CRM is a partner CRM, as contracted in Milestone 7. Customer records, support tickets and campaigns are not in any milestone; we can scope them in a Change Report if you want them.
```
