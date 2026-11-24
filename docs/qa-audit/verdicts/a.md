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

```
ID: F51a
Title: Partnerships money and count fields refused plain numbers
Verdict: FIXED_SINCE_AUDIT
Severity: High
Module: Partnerships
Evidence: Root cause confirmed: the contract's money rule needs exactly two decimals (packages/contract/schemas/common.js:95-97; node check: "750000" and "750,000" refused, "750000.00" accepted) and ReturnSave counts are numbers (partner_pipeline.js:930-939; "5" as text refused), and the forms checked the contract against the text as typed. Commit 4978ae8 adds moneyOnWire, countOnWire and checkedOnWire (app/src/features/partnerships/forms/parts.tsx:40-66) so New Lead, New Partner, New Deal, Edit Deal (DealForm.tsx:58,68-69), deal options (optionsOnWire) and Enter Returns (ReturnsForm.tsx:19-29,48) are checked and sent as "750000.00" and 5. MoneyField accepts plain, comma-grouped and 0 to 2 decimals (packages/ui/src/form/MoneyField.tsx:55-69). screens.test.tsx "typed amounts and counts go out as the contract takes them (F51, F61)" passes (23/23); integration suites pass (64/64).
Scope ref: docs/guides/partnerships.md §6.14, §6.19, §10.1 ("amounts typed plain or with commas"); MILESTONES gate 20 (money as two-place strings)
Fix: None.
Effort: S
For MyCity: Amounts can now be typed as 750000, 750,000 or 750000.5 and counts as plain numbers; the form converts them before saving. Fixed on 17/11.
```

```
ID: F51b
Title: Custom money fields still refuse amounts typed with commas
Verdict: BUG
Severity: Low
Module: Partnerships
Evidence: Code reading plus a node check. A category's custom field of type money is a MoneyField that keeps commas as typed (parts.tsx:359-360), and customOnWire passes it unchanged (parts.tsx:382-386, only numbers are converted); the server parses it with shared/money, which refuses "750,000" (node: money.money("750,000") throws; "750000" passes), so partner_pipeline.fields.js:120-125 answers "Not an amount". Only affects custom money fields, which MyCity adds on Categories.
Scope ref: docs/guides/partnerships.md §6.3 (custom fields, money through shared/money), §10.1 (amounts typed plain or with commas)
Fix: In customOnWire (app/src/features/partnerships/forms/parts.tsx), send money custom values through toMoneyString like the other amounts; add a case to the screen test.
Effort: S
For MyCity: One small case remains: a custom money field you add to a category refuses an amount typed with commas. We will fix it.
```

```
ID: F51c
Title: Money fields in other modules checked for the same fault
Verdict: NOT_REPRODUCED
Severity: Low
Module: Platform (Payroll, Expenses, Recruitment, People, Queries, Policies, AI Control, Settings)
Evidence: Code reading of every MoneyField outside Partnerships: each converts what was typed to the two-place wire form before it checks and before it sends. toMoneyString in payroll/PayRuns.tsx:527, payroll/Deductions.tsx:353, payroll/Configurations.tsx:555,626-627,818,928-929, expenses/Projects.tsx:101, expenses/index.tsx:581-582, recruitment/OfferForm.tsx:90, VacancyForm.tsx:94-95, VacancyInterview.tsx:86,109-110, people/TaxAndPension.tsx:167, people/EmployeeForm.tsx:128-135, ai-control/Spend.tsx:48-52, settings/Stages.tsx:202, policies/worksheet.ts:18; queries/index.tsx:316,326 uses its own equivalent. Shared components do too (assistant/ActionCard.tsx:373, form/LinesField.tsx, form/QuestionCard.tsx:73-90). The auditor tested Partnerships forms only.
Scope ref: MILESTONES gate 20; CLAUDE.md money rule
Fix: None (only F51b remains).
Effort: S
For MyCity: We checked every money field in the hub. Outside Partnerships they already accepted plain and comma-grouped amounts; the fault was limited to Partnerships and is fixed.
```

```
ID: F52
Title: Past close dates accepted and deals never turned Overdue
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8 (migration 7130, seed 7191). New Lead, New Deal and Edit Deal refuse a past expected close while the deal is to win ("Pick today or later"); the morning job marks open deals past their close date Overdue (partner_pipeline.inactivity.markOverdue, run first by the partner-inactivity scheduler), a person cannot set Overdue, and a new date puts it back On Track. tests/integration/partnerships-records.test.js:729 covers all of it; ran green on HEAD (64/64 across four Partnerships suites).
Scope ref: docs/guides/partnerships.md §6.5 (Expected close, Health: Overdue), §6.12
Fix: None.
Effort: S
For MyCity: A deal still being pursued can no longer be given a past close date, and each morning any open deal past its close date turns Overdue. Fixed on 17/11.
```

```
ID: F53a
Title: A deal could be signed with no value
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8. A person's move into a signed stage, Convert to Partner and New Partner refuse a deal with no projected value ("Add the deal's value", DEAL_VALUE_REQUIRED) unless No Money Value is ticked (partner_pipeline.stages.js:89-94, partner_pipeline.service.js:275). tests/integration/partnerships-records.test.js:689 (stage move) and :510 (New Partner) pass; screens.test.tsx checks the screen asks for No Money Value (moveNeeds).
Scope ref: docs/guides/partnerships.md §6.5 ("Signing needs a value"), §10.1
Fix: None.
Effort: S
For MyCity: A deal now needs a value, or an explicit No Money Value tick, before it can be signed. Fixed on 17/11.
```

```
ID: F53b
Title: A signed deal's value can be cleared afterwards
Verdict: BUG
Severity: Low
Module: Partnerships
Evidence: Code reading. Edit Deal copies estimated_value as sent, null included (partner_pipeline.service.js:391, the changes loop in update), with no check that a signed deal keeps a value or is No Money Value; DealUpdate allows null and DealForm.tsx:68 sends null when the field is emptied. So the F53 rule can be undone after signing.
Scope ref: docs/guides/partnerships.md §6.5 ("Signing needs a value")
Fix: In partner_pipeline.service.update, refuse estimated_value null (or 0.00) on a deal with signed_at unless it is non_monetary ("Add the deal's value"); one integration case.
Effort: S
For MyCity: Once signed, a deal's value can still be emptied through Edit Deal. We will close that gap so a signed deal always keeps its value or its No Money Value mark.
```

```
ID: F54a
Title: Duplicate warning does not block saving
Verdict: BY_DESIGN
Severity: Low
Module: Partnerships
Evidence: The duplicate check is advisory: "Nothing blocks" (docs/guides/partnerships.md §6.2), a decision taken so two people do not capture the same organisation twice while allowing genuine namesakes (TB, 06/11/2026, §6.1, §13.2). LeadForm.tsx:24-39 shows "Already here: <name>, <number>" and, for a partner, offers New Deal on it.
Scope ref: docs/guides/partnerships.md §6.2, §11 ("A duplicate: warned, never blocked")
Fix: None required. If MyCity wants it, an explicit Create Anyway with a reason is a small change (S) to be agreed first.
Effort: S
For MyCity: The warning is deliberately a warning, as agreed, so a genuinely separate organisation with a similar name can still be added. We can add a "Create Anyway" confirmation if you prefer.
```

```
ID: F54b
Title: Duplicate check misses near names and uses the name only
Verdict: GAP
Severity: Medium
Module: Partnerships
Evidence: Reproduced with the module's own scoring (node, src/shared/dedup/dedup.js with partners.dedup.js SIGNALS): "Kora Street Kitchens" and its lower case score 60 (match); "kora street kitchen" scores 0 and "Kora St Kitchens" 0, because a similar name is scored by whole words shared (dedup.js:97-104, threshold 0.6; one plural is 2 of 4 words). The SQL already finds such candidates by trigram (partners.dedup.js:56) but the score discards them. The screen also asks with the name alone (DuplicateNotice name={org.values.name} at LeadForm.tsx:122 and PartnerForm.tsx:101), though the API and §6.2 check email, phone and website host too.
Scope ref: docs/guides/partnerships.md §6.2 ("name (similar, via shared/dedup), email, phone, website host"; "New Lead and New Partner show the likely match before saving")
Fix: Score the name signal with the trigram likeness the query already returns (for example a match from 0.6 likeness) or stem plurals in dedup.norm.company; pass the contact's email and phone and the website to DuplicateNotice once entered (LeadForm.tsx, PartnerForm.tsx).
Effort: S
For MyCity: The duplicate check catches exact names but misses small spelling differences, and the screen only checks the name. We will make it match near names and also check the contact's email, phone and website.
```

```
ID: F59
Title: Log Interaction only reachable from the More menu
Verdict: FIXED_SINCE_AUDIT
Severity: Low
Module: Partnerships
Evidence: Commit 4978ae8: Partner360.tsx and Lead360.tsx pass onLog={logInteraction} to ActivityTab, so Log Interaction sits above the interactions on the Activity tab (hidden for a read-only record); it stays in the More menu too. Code reading of the diff.
Scope ref: docs/guides/partnerships.md §10.1 Partner 360 ("on Activity ... Log Interaction above the interactions")
Fix: None.
Effort: S
For MyCity: Log Interaction now has its own button on the Activity tab of every partner and lead. Fixed on 17/11.
```

```
ID: F61a
Title: Partner returns could not be saved
Verdict: FIXED_SINCE_AUDIT
Severity: High
Module: Partnerships
Evidence: Root cause as F51a: Units Sold and Downloads were checked as text against number rules ("Required"), amounts against the two-decimal rule. Commit 4978ae8 converts them first (ReturnsForm.tsx:19-29 returnsOnWire, :48 checkedOnWire). A month must also add up: commission within gross sales ("More than gross sales") and paid to the partner within what the commission leaves ("More than sales left") (partner_pipeline.returns.js). screens.test.tsx (returnsOnWire with "5", "100,000", "92000.5", and all empty) and tests/integration/partnerships-records.test.js:720 (150,000 commission on 100,000 gross refused; a consistent month saves 200) pass on HEAD.
Scope ref: docs/guides/partnerships.md §6.14 ("A month entered must add up")
Fix: None.
Effort: S
For MyCity: Returns can now be saved with plain numbers, and a month whose commission or payout exceeds gross sales is refused. Fixed on 17/11.
```

```
ID: F61b
Title: Commission not suggested from the category rate
Verdict: IMPROVEMENT
Severity: Low
Module: Partnerships
Evidence: Enter Returns asks for MyCity Commission as typed (ReturnsForm.tsx:71); nothing suggests it from the deal's rate. §6.14 does not ask for it; deal options already default commission per sale from the rate (§6.6).
Scope ref: docs/guides/partnerships.md §6.6, §6.14
Fix: Prefill MyCity Commission as gross sales times the deal's commission rate (the category's default when the deal has none), still editable, for holders of partnerships.money (ReturnsForm.tsx).
Effort: S
For MyCity: Commission on a month's returns is typed in. We can pre-fill it from the deal's rate (for example 8% for Events) as a suggestion you can change.
```

```
ID: F62a
Title: AI proposal questions hung for minutes with no way forward
Verdict: FIXED_SINCE_AUDIT
Severity: High
Module: Partnerships
Evidence: Commit 4978ae8: the questions job runs once (proposals.events.js:72-73, attempts 1; it had been five silent attempts across two providers), a job silent for three minutes (the draft ten) reads as failed and Try Again restarts it, and Write It Myself (POST /proposals/:id/own-words, proposals.service.js:406-439) fills the kit from the record while the cards are asked or after they fail, so a proposal never waits on the AI. tests/integration/partnerships-proposals.test.js:376 covers it and passed on HEAD.
Scope ref: docs/guides/partnerships.md §6.10 step 2, §11 ("AI off, capped or failing")
Fix: None.
Effort: S
For MyCity: A failed AI step now shows as failed within minutes with Try Again, and Write It Myself lets you build the proposal without the AI. Fixed on 17/11.
```

```
ID: F62b
Title: AI provider account must be funded for proposals
Verdict: CLIENT_ACTION
Severity: Medium
Module: Partnerships / AI Control
Evidence: The studio's AI jobs run Anthropic first, then Gemini Pro (docs/guides/partnerships.md §6.10 "The AI"); the guide's open list still has "MyCity's Anthropic account funded and its key entered on Settings · Integrations before the studio is demonstrated" (§13.3). A missing or unfunded key is a likely reason the questions never arrived on staging. Could not check staging's settings from here.
Scope ref: docs/guides/partnerships.md §6.10, §13.3
Fix: None in code.
Effort: S
For MyCity: Please fund MyCity's Anthropic account and enter its key on Settings, Integrations (and confirm the Gemini key), then retry PRO-0003; we will check the job log with you.
```

```
ID: F63
Title: Closing a partner rewrote its signed deal as lost
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8, partners.service.js close: signed deals now end as Completed with the reason, only open deals are lost. tests/integration/partnerships-records.test.js:510 asserts the closed partner's deals are ["completed", "lost"] and passed on HEAD.
Scope ref: docs/guides/partnerships.md §6.6 ("its signed deals end as Completed with that reason, never rewritten as lost")
Fix: None. On staging, QA-AUDIT-Deal-01 keeps the Closed Lost it was given before the fix; correct or close it on screen.
Effort: S
For MyCity: Closing a partner now ends its signed deals as Completed, not lost. The test deal closed during the audit still shows the old result and can be corrected on screen.
```

```
ID: F64
Title: Stages skipped without reason; lost deal still On Track
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8: a forward move past an active stage needs a reason of 10+ characters, kept on the history line (partner_pipeline.stages.js; tests/integration/partnerships-records.test.js:307, Prospect Identified straight to Proposal Sent refused "Say why", then accepted with a reason); a finished deal shows Lost or Completed instead of its health (lib.ts healthPill; screens.test.tsx "a finished deal shows how it ended"). Evidence per stage (a proposal before Proposal Sent) was not adopted: JBS Praxis chose a reason to skip (§6.5, 17/11/2026).
Scope ref: docs/guides/partnerships.md §6.5, §10.1 Stage switcher, §13.2 entry 17/11/2026
Fix: None.
Effort: S
For MyCity: Skipping stages now needs a written reason kept in the history, and a lost or completed deal shows that instead of On Track. Fixed on 17/11.
```

```
ID: F23a
Title: Converted lead showed Last Contact Never
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8, src/modules/leads/leads.repo.js:14-19: a converted lead's last contact is the later of its own and its partner's interactions (conversion moves them to the partner). tests/integration/partnerships-records.test.js:706 logs a call on the partner and reads the converted lead's last_contact_at; passed on HEAD.
Scope ref: docs/guides/partnerships.md §6.4, §6.12
Fix: None.
Effort: S
For MyCity: A converted lead now shows its partner's latest contact. Fixed on 17/11.
```

```
ID: F23b
Title: Never in the list but Today in the record header
Verdict: BY_DESIGN
Severity: Low
Module: Partnerships
Evidence: The list shows Never when no interaction is logged; the 360's Days Since Last Contact counts from when the record was added when there is none (leads.360.js:88, partners.360.js:95), as its help says: "since it was added when there is none" (record.tsx:324). This matches the quiet rule, which counts a never-contacted record from its creation (§6.12). Staging leads at late stages with no interactions are demonstration seed records with no logged calls.
Scope ref: docs/guides/partnerships.md §6.2 (KPI cards), §6.12
Fix: None required. Optional: show "None" in the header until a first interaction (S).
Effort: S
For MyCity: The header counts days since the record was added when nothing has been logged yet, as its help text explains; the list says Never. We can make the header say None in that case if you prefer.
```

```
ID: F06a
Title: Departed Operations & People lead owned the partnership book
Verdict: FIXED_SINCE_AUDIT
Severity: High
Module: Partnerships
Evidence: The book on staging was our demonstration seed: before 4978ae8, seeds/staging/70_partnerships.js gave records to the "head" slot, the first Head of Department on the register, falling back to Operations & People (git show 4978ae8^:seeds/staging/70_partnerships.js, owner: "head" on most records). Commit 4978ae8 gives seed records to Partnership & Growth and Branding & Marketing staff and, on its next run, moves records it made that were left with Operations & People (70_partnerships.js step 5); tests/integration/partnerships-staging-records.test.js:94 and :105 pass on HEAD. New and Edit Lead, Partner and Deal now refuse an owner without an active login and Partnerships edit ("Not in Partnerships", partner_pipeline.service.js:69-82); partnerships-records.test.js:747 passes. Note: the Operations & People role still holds Partnerships edit in the seeded grants (seeds/reference/0290_seed_roles_and_grants.sql:55), so its holder can still be an owner until MyCity unticks it (F06d).
Scope ref: docs/guides/partnerships.md §6.1 ("An owner works in Partnerships", 17/11/2026), §11 (owner leaves), §13.2 entry 17/11/2026
Fix: None in code. Re-run the staging seed (next deploy) so the demo records move.
Effort: S
For MyCity: The partner and lead records on staging were our demonstration data, wrongly given to the Operations & People lead. They now belong to Partnership & Growth and Branding & Marketing staff, and only active staff with Partnerships access can own a record.
```

```
ID: F06b
Title: No forced reassignment of owned records when someone leaves
Verdict: OUT_OF_SCOPE
Severity: Medium
Module: People (offboarding), cross-module
Evidence: Archive Record (organisation.service.js:841-865) archives the person, closes their login, ends training and reviews, stops pushes and removes headship roles (employee.archived handlers in identity, training, reviews, notifications); it does not list or force reassignment of owned records (partners, leads, deals, projects, department headship, report audiences). Approvals already have Reassign (POST /workflow/instances/:id/reassign, docs/guides/foundation.md §11). The decided behaviour for Partnerships is reassignment on screen: "their records keep them as a former employee until reassigned on screen" (docs/guides/partnerships.md §11). No milestone mentions an offboarding or exit workflow (MILESTONES M1 §6 to M11 searched for offboard, exit, leaver, reassign: only payroll's leaver final run, §11).
Scope ref: docs/guides/partnerships.md §11; MILESTONES (no offboarding milestone)
Fix: None under contract. A Change Report would cover an Offboard step on Archive Record that lists everything the person owns across modules (partnership records, projects and tasks, department headship, report audiences, waiting approvals, open proposals) and requires a new owner for each, in one transaction through each module's service.
Effort: L
For MyCity: Today a leaver's records are handed over one by one on screen, as agreed. A guided offboarding step that forces every record to a new owner is not in the contract; we can scope it in a Change Report.
```

```
ID: F06c
Title: Our staff seed still loads the departed Operations & People lead
Verdict: SEED_DATA
Severity: High
Module: People (staff seed)
Evidence: seeds/staff/staff-list.xlsx row 7 (S/N 6, staff ID 00018) still lists Cynthia Osasere Osakunih as Operations & People Lead, People & Culture (read with exceljs); seeds/staff/roles.json:17-21 gives that post the operations_people role and the work email cynthia@mycityapp.io; seeds/staff/nomenclature.json:14 makes that post head of People & Culture. scripts/db/load-staff.js loads this sheet on staging and production at every deploy, so production's first deploy would create her record with an invited Operations & People login and as department head. On staging the sheet is already loaded, so archiving her there is not undone.
Scope ref: CLAUDE.md (seeds/staff loaded on staging and production, TB 16/10/2026); docs/guides/foundation.md §6.1; guide §13.3 (Cynthia's handover)
Fix: Get MyCity's current staff list: remove or replace row 7 in seeds/staff/staff-list.xlsx with the new Operations & People Lead, and update roles.json's work_email for the post (and the note), before the production deploy.
Effort: S
For MyCity: Our copy of your staff list still names Cynthia as Operations & People Lead, which would recreate her on the live system. Please send the new lead's details (name, email, start date) and we will update the list before go-live.
```

```
ID: F06d
Title: Staging records still held by the departed lead
Verdict: CLIENT_ACTION
Severity: Medium
Module: People / Home / Workspace / Settings
Evidence: Outside the demo partnership records (F06a), the auditor's items are held on staging by the person: projects PRJ-2026-000005 and 000006, headship of People & Culture, the Daily Attendance and Weekly Headcount report audiences, and the Operations & People role. Each has an on-screen owner change; nothing reassigns them automatically (F06b). The 17/11 note lists these as MyCity's to do (docs/PROGRESS.md 17/11/2026 note: "untick Partnerships on the Operations & People role, set the Program Manager as acting head of Partnership & Growth, hand Cynthia's records to their owners").
Scope ref: docs/guides/partnerships.md §6.1, §11, §13.2 entry 17/11/2026, §13.3
Fix: None in code. MyCity: People · Departments, Set Head for People & Culture (and the Program Manager as acting head of Partnership & Growth); Workspace, change the two projects' owner; Home · Reports, change the two reports' audiences; Settings · Roles & Permissions, give the role to the new lead and untick Partnerships on the Operations & People role if that department should not own partner records.
Effort: S
For MyCity: Please hand Cynthia's remaining items to their new owners on screen: department head on People, Departments; the two projects; the two report audiences on Home, Reports; and the role on Settings, Roles & Permissions. We can walk through it with you.
```

```
ID: F06e
Title: Owner filter cannot find records held by a leaver
Verdict: IMPROVEMENT
Severity: Low
Module: Partnerships
Evidence: The Owner filter on Partners, Leads and Pipeline offers active employees only (app/src/features/partnerships/lib.ts:81-84, GET /employees status active), so a person cannot list a leaver's book to reassign it, although §11 says those records are reassigned on screen.
Scope ref: docs/guides/partnerships.md §11 ("their records keep them as a former employee until reassigned on screen")
Fix: Add former owners who still hold records to the Owner filter (or a Former Owner chip), so the book can be found and reassigned with Edit Lead, Edit Partner and Edit Deal.
Effort: S
For MyCity: We will let the Owner filter show people who have left but still own records, so their book is easy to find and hand over.
```

```
ID: F07a
Title: Signed deals had no agreement in Contracts & MOUs
Verdict: FIXED_SINCE_AUDIT
Severity: Medium
Module: Partnerships
Evidence: Commit 4978ae8: a deal signed on the stage switcher or by Convert to Partner with an uploaded signed copy, and no agreement on file, now gets an agreement recorded as signed outside the hub with the copy as its file (partner_pipeline.stages.js:132-135, agreements.generate.js:225-268); the daily job then makes it Active. tests/integration/partnerships-records.test.js:689 checks the agreement row (status signed, signed_outside, the copy) and passed on HEAD. Moving to a signed stage already required the signed copy (the auditor agreed). The six signed partners seen on staging are demonstration records seeded as "signed before the hub" with no copy, which by design have no agreement (docs/guides/partnerships.md §6.6).
Scope ref: docs/guides/partnerships.md §6.5 ("A signed copy is its agreement"), §6.6
Fix: None.
Effort: S
For MyCity: A deal signed with an uploaded copy now appears in Contracts & MOUs as an agreement signed outside the hub. The six signed partners on staging are demonstration records entered as signed before the hub.
```

```
ID: F07b
Title: New Partner's signed copy is not recorded as an agreement
Verdict: GAP
Severity: Low
Module: Partnerships
Evidence: Code reading. New Partner with a signed copy attaches it to the partner's documents (partners.service.js:258-265) but never calls agreements.generate.recordedIn, whose only caller is the stage move (partner_pipeline.stages.js:134); recordedIn's own comment says it covers "New Partner's signed copy" (agreements.generate.js:226), and the 17/11 decision aims at "every deal signed with a copy has its agreement on file". So a partner added with its copy has no row in Contracts & MOUs.
Scope ref: docs/guides/partnerships.md §6.5 ("A signed copy is its agreement", QA F07), §6.6
Fix: In partners.service.createIn, when signed_copy_document_id is given, call agreements.generate.recordedIn(client, actor, deal.deal_id, body.signed_copy_document_id) after the deal is made; extend the New Partner integration test.
Effort: S
For MyCity: A partner added with New Partner and its signed copy does not yet show an agreement in Contracts & MOUs. We will record it there, as we now do for deals signed on the pipeline.
```

```
ID: F07c
Title: In Approval card and In Review rows disagree
Verdict: IMPROVEMENT
Severity: Low
Module: Partnerships
Evidence: The KPI card "In Approval" counts agreements in both review and approval with a pending approval (agreements.repo.js:115-116), while rows and chips name status review "In Review" and approval "In Approval" (app/src/features/partnerships/lib.ts:167-168, Contracts.tsx:46-47). Both statuses wait on an approver (§6.8: review is the first stage waiting, approval a later stage). Not changed by 4978ae8.
Scope ref: docs/guides/partnerships.md §6.8 lifecycle, §10.1 Contracts & MOUs (KPI strip: In Approval)
Fix: Label status review as "In Approval" with its stage (for example "Approval · Stage 1"), or make pressing the card show both statuses; keep the chips matching (lib.ts, Contracts.tsx).
Effort: S
For MyCity: "In Review" agreements are counted under the In Approval card because both are waiting for an approver. We will make the names match.
```

```
ID: F07d
Title: Vendor category has no agreement template
Verdict: CLIENT_ACTION
Severity: Medium
Module: Partnerships
Evidence: Generate Agreement uses the category's default template (§6.8); templates are MyCity's, built on Categories (Add Template, Tidy With AI), never seeded on production (A26). Only the Events category's Deal Merchant Agreement was supplied by MyCity and is rebuilt on staging (seeds/staging/65_partnership_setup.js); the ticketing template is still awaited (§13.3). The auditor confirmed Events works end to end.
Scope ref: docs/guides/partnerships.md §6.8, §13.3; MILESTONES §12 Amended 05/11/2026 (categories carry their agreement templates, A26)
Fix: None in code. MyCity adds a template for Vendor (and each category it signs) on Partnerships · Categories · Templates, pasting its Word agreement into Tidy With AI.
Effort: S
For MyCity: Each category needs its own agreement template, which your team adds on Categories, Templates (paste your existing agreement into Tidy With AI). Send us the Vendor agreement and we can help set it up.
```

Throwaway test files created: none (all claims settled with existing tests, direct contract checks and code reading). git status --short: empty.
