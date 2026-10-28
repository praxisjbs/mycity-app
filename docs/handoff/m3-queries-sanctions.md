# M3 Queries & Sanctions · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what the 26/10/2026
meeting asked for, the decisions GE took (do not ask them again), how each screen works as built,
the points still to agree with Victor, the checklist with its status, and a dated log. The design
itself is `docs/guides/queries.md`; this file is the build plan and its log.

| | |
|---|---|
| Branch | `m3/queries-sanctions` (push only here; the PR targets `main`; restarted from `main` after #22 merged) |
| Pull request | #22, merged 27/10/2026; the sequel (§9) is a new PR |
| Owner | GE (Godwin-Okoh Elisha); handed to Victor on 27/10/2026 |
| Type | Full stack (CLAUDE.md step 1) |
| Started | 26/10/2026 |

---

## 0 · How to continue

1. `git fetch origin m3/queries-sanctions && git checkout m3/queries-sanctions && git pull`.
2. Read this file in full, then `docs/guides/queries.md`, `docs/guides/ess.md`, then what CLAUDE.md
   step 2 asks for full-stack work.
3. Agree §4 with GE first. Nothing in §5 items 11 and 12 starts before that: the User Guide's
   pictures show the screens as agreed.
4. Take the first unticked step in §5. Build it, run its checks, tick it here with the date, add a
   line to §7, commit and push.
5. Never re-open §2. Running the suite locally needs `NODE_OPTIONS=--max-old-space-size=4096` (§6).
   Mark #22 ready for review once the whole `npm run ci` is green locally.

---

## 1 · What was asked

The M3 build from TB's branch (`claude/dreamy-bell-6wlskq`, 9 commits) brought onto `main`, then the
26/10/2026 meeting's items:

1. ESS: one My Queries tab with a Queries | Sanctions switch. Sanctions read only, each opening its
   letter. On a phone, a segmented control at the top.
2. Employee 360: Queries and Sanctions tabs, shown only with `queries` view.
3. The ESS response is rich text, sanitised on the server with the existing sanitiser (no second
   copy). Rich text in the letter template editor too.
4. Raise Query works in the demo (mock) build.
5. A Salary Deduction letter (the amount through `shared/money`); the seeded Caution Letter renamed
   Question Letter.
6. A drawn signature when raising a query or proposing a sanction, kept through the upload engine
   and the vault as a `document_id`, printed on the letter.
7. Letters fit one page where they can; past one page the header and footer repeat with page
   numbers. Organisation details from Settings · Organisation.
8. A query can cite a Knowledge Hub policy; a rule names the policy and the letter quotes it.
9. Write With AI on Raise Query and on the letter editor, built like the mailbox's.
10. Rules: overdue tasks, and low monthly performance from M2's monthly scores.
11. Before any M3 picture, agree each screen's mechanics (§3, §4). Then: demo queries and sanctions
    in the staging seed only, the User Guide chapter and sections, their pictures.
12. Finish: the guide, PROGRESS (#13, #34 to #37), the README map, `npm run ci`.

---

## 2 · GE's decisions (26/10/2026, binding)

1. ~~**The Question rung sits after the Warning.** The ladder is Warning, Question, Second Warning,
   Suspension, Suspension Without Pay, Dismissal or Termination.~~ Superseded 27/10/2026: the
   ladder below, ratified in MILESTONES §8.
2. **Write With AI's jobs:** `query-draft` on Default, `letter-draft` on Deep Reasoning. Both are
   registered in `src/services/ai/actions.js` with `chosen_by: "GE"`, personal data.
3. **Nothing is kept until Use Draft.** When AI is off or this month's budget is spent the button
   says so (AI Is Off, AI Limit Reached) and the form works as before.

---

### Decisions of 27/10/2026, afternoon (AJ, with GE and TB; from MyCity's samples and handbook)

These replace §2 decision 1 and the §4 answers they name. Each is in `docs/guides/queries.md` §13.

1. **Attendance owns its rules.** A breach with Raise Query on raises its query
   (`queries.raise_from_breach`, migration 3040's FK). Rules drops Late Arrival, Absence and
   Missing Clock-Out; MILESTONES' "three late arrivals" is the Attendance policy's row.
2. **Ladder as ratified in MILESTONES §8:** Caution, Warning, Second Warning, Suspension Without Pay,
   Dismissal or Termination. "Question" was the transcript mishearing "Caution".
3. **24 hour response window** (handbook §4.7.1, both query samples). Replaces §4 answer 7.
4. **Migrations keep their numbers** (MIGRATIONS §3: below the head applies, with a warning).
5. **Operations & People sign a sanction's letters when they approve it** (every sample is signed so).
   Replaces §4 answer 2. Approve Sanction and Reject sit on the query's card.
6. **One suspension, without pay**; the CEO approves from it up (handbook §4.7.4).
7. Edit Rule; a review shows its month's queries; Dismissal records the sanction and People archive
   the record; the ladder is entered at go-live; the three unused fine columns stay.
8. Five letters' wording is MyCity's samples (the Salary Deduction letter is ours), all six shipped
   active; redacted copies in
   `docs/MyCity-ERP-Documents/letter-samples/`.

## 3 · How each screen works (as built)

Brought up to the afternoon decisions and the audit's fixes (§8) on 27/10/2026.

### 3.1 Raise a Query (Queries · Raise a Query)

Anyone with `queries` create. Partnerships, for example, have no button.

| Field | Rule |
|---|---|
| Employee | Active staff only; nobody queries themself |
| Subject | 4 to 150 characters |
| What Happened | 20 to 4,000 characters |
| Policy, Clause | Both Optional. Only policies with a version in force are offered; the query keeps that day's version and the letter quotes the clause |
| Your Signature | Required. Kept in the vault, printed on the query letter above the raiser's name |

**Write With AI** opens a step in the same window: What To Say, **Write Draft**, then **Try Again**
or **Use Draft**. It fills Subject and What Happened only. On **Raise Query** the employee is told
in the app and by email, the query letter is made, and they have 24 hours to respond. Only people
with `queries` create see the button (it is on ⌘K too).

### 3.2 Queries (Queries & Sanctions · Queries)

- Operations & People, Management, Implementation and the CEO see every query. Anyone else sees only
  the queries they raised, even within their own team. A rule's queries are seen by the first group only.
- KPI strip (Open, Awaiting Response, Closed This Month, Escalated), the **All Queries** and
  **Raised by Me** chips, the list. A picked row opens beside the list: subject, raised by (a person,
  a rule or the Attendance Policy), raised, response due, the policy cited, the days a rule counted,
  the response, the sanction (a refused one reads Not Approved), and who it waits on.
- **Send Reminder** once a day while a response is awaited; **View Letter**; **Record Decision**;
  **Approve Sanction** and **Reject** for whoever the sanction waits on.
- Phone: two KPI cards, query cards with a status pill, a tapped card in a bottom sheet with
  **Record Decision** at its foot; **Raise a Query** full width.

### 3.3 Record Decision

- Needs `queries` edit; the person queried never decides their own. Before the 24 hours end it needs
  the response; after, it does not.
- **Close, No Action:** a reason of at least 10 characters; the query is resolved.
- **Sanction:** the rung (the next one marked Next; only rungs whose letter is ready), dates for an
  unpaid suspension, Evidence for a rung that requires it, an optional fine and the reason. Nobody
  signs a proposal. It opens the approval, and the query shows Escalated until it is decided.
- Approval, on the query's card only: Operations & People on every rung, signing as they approve;
  then the CEO for Suspension Without Pay and Dismissal or Termination. The person queried never
  decides it. A refusal sends the query back under review.

### 3.4 Sanctions and Chain Settings

- A second offence offers the rung after the highest one still in force for that person. People may
  pick another, and the choice is recorded.
- Sanctions: KPIs, then the history (employee, sanction, query, reason, decided by, date, fine,
  status), **Issue Sanction**, **Chain Settings**.
- Chain Settings: **Add Step**, **Move Up**, **Move Down**, **Retire**, **Restore**. A rung names its
  letter, its money effect and how long it stays in force; a rung with sanctions is never deleted.
- A fine is not a rung: it rides on any sanction and waits as pending for payroll (M6).

### 3.5 The letters

- One page where it fits; longer, the letterhead and footer repeat with "Page n of N".
- A query letter is signed by its raiser; a rule's or the Attendance policy's query is signed
  Operations & People. A sanction letter is signed by the Operations & People approver (name, job
  title, drawn signature), "For" the organisation.
- With a fine, the Salary Deduction Letter goes too, and both leave in one email once both PDFs exist.

### 3.6 Letter Templates

- The list (template, used by, status) and the picked letter's preview on paper, the record's words
  underlined.
- **New Template** and **Edit Template** are rich text; names such as `{{ employee.first_name }}`
  stay as typed, and a name a letter cannot fill is refused on save.
- **Write With AI** drafts the wording with the letter's own names only, never a signature or a
  closing; it needs `queries.configure`. **Activate** is refused while there is no wording.

### 3.7 Rules

A rule is saved as a draft, counts only from when it is switched on, and is paused rather than
deleted. "N offences in D days raise one query", the counted days or tasks as its evidence. Late
arrivals, absences and missing clock-outs are the Attendance policy's, which raises their queries.

| Trigger | What counts |
|---|---|
| Unregistered Device | A punch from a device not on the person's list |
| Overdue Task | A Workspace task whose due day passed while open, or done on a later day; the primary assignee; counted on the due day, checked each morning at 06:20 Lagos; cancelled and archived never |
| Low Monthly Score | A monthly review closed rated Below, counted the day it closed; probation reviews never |
| Missed Target | Drafted only, until M2's KPIs count it |

### 3.8 ESS · My Queries

- One tab, a **Queries** | **Sanctions** switch with each one's count.
- Queries, open first: subject, raised, respond by, what happened, the response, the outcome, any
  sanction; **View Letter**, **Respond** (rich text, 20 to 4,000 characters of text, cleaned on the
  server).
- Sanctions are read only; each opens its letter, then the deduction letter if there was a fine.
- Phone: the switch as a segmented control at the top, then cards; **Respond** full width at the
  foot of the sheet; a sanction's letter opens full screen.

### 3.9 Employee 360 (People · a person's record)

- **Queries** and **Sanctions** tabs, only with `queries` view, under the same visibility as the
  Queries screen. A row opens the record on Queries.

---

## 4 · To agree with Victor before any picture

1. **Ladder order.** The definition of done's "a second offence offers the second warning" now
   offers Question. Keep the order, or put Second Warning straight after Warning?
2. **Who signs a sanction letter.** Built: the proposer. The alternative is the last approver.
3. **Signature on every manual query.** Built as required. May Operations & People raise one
   unsigned, signed "Operations & People"?
4. **Salary Deduction Letter wording.** Ours; MyCity's HR reads it before it goes live.
5. **Rules quote a policy, not a clause.** The rule form stays at six fields; add a Clause if rule
   letters should quote a line.
6. **Overdue Task and Low Monthly Score** as §3.7 counts them. Confirm, or name another cut (Partly
   Meets as well, for example).
7. **The 48 hour window** and one reminder a day.

Record each answer here with its date, and change the guide first if an answer changes behaviour.

**Agreed 27/10/2026 (GE and AJ/Victor), the morning.** Answers 1, 2 and 7 were replaced the same
afternoon (§2's afternoon decisions): the ladder, who signs and the window are struck through.

1. ~~Ladder order: kept as built. Warning, Question, Second Warning, Suspension, Suspension Without
   Pay, Dismissal or Termination.~~ Now Caution first, one suspension.
2. ~~A sanction letter is signed by its proposer, as built.~~ Now Operations & People, approving.
3. Every manual query is signed, as built. No unsigned Operations & People query.
4. The Salary Deduction letter keeps our wording; MyCity's HR reads it before go-live.
5. **Change:** the rule form gains an Optional **Clause** (at most 300 characters), quoted on the
   rule's query letters. The table, contract, repo and evaluator already carry `policy_clause`;
   only the rule form and the mock change. `queries.md` §13 updated first.
6. Overdue Task and Low Monthly Score count as §3.7 says, as built.
7. ~~The 48 hour window~~ 24 hours, and one reminder a day.

Also agreed the same day:

- The User Guide chapter and its sections go in this PR (#22), not a later one; the
  `User-guide-unchanged` line leaves #22's description once they are in.
- The staging seed carries the ~~six~~ five rungs, at least one rule, and demo queries and
  sanctions. Staging only, never production; on the Implementation department's accounts only (TB).
- ~~Suspension, Suspension Without Pay and Termination stay Needs a Letter until MyCity sends the
  samples.~~ The samples came the same afternoon: every letter ships active in MyCity's wording.

---

## 5 · Checklist

- [x] Step 0: TB's 9 commits onto `main`; people on the M3 lists carry their photo (26/10/2026)
- [x] 1 and 3: My Queries switch, rich text response (26/10/2026)
- [x] 2: Employee 360 tabs (26/10/2026)
- [x] 4: Raise Query in the demo build (26/10/2026)
- [x] 5: Salary Deduction letter; Question Letter after Warning (26/10/2026)
- [x] 6 and 7: signatures, the letter layout (26/10/2026)
- [x] 8: policy citations, migration `3030` (26/10/2026)
- [x] 3 (editor): rich text Letter Templates (26/10/2026)
- [x] 9: Write With AI, `query-draft` and `letter-draft` (26/10/2026)
- [x] 10: `overdue_task` and `low_performance` (27/10/2026)
- [x] Mechanics summarised for Victor (this file, §3 and §4) (27/10/2026)
- [x] §4 agreed with Victor (27/10/2026)
- [x] 5: Clause on the rule form (§4 answer 5): New Rule and Edit Rule, at most 300 characters, cleared
  with the policy (27/10/2026)
- [ ] MyCity's HR read the Salary Deduction letter's wording: at the show and tell
- [x] 11: demo queries and sanctions in the staging seed only, never production: the five rungs
  (Caution replacing Question, one suspension), a rule, queries and sanctions
  (`seeds/staging/50_queries.js`, tested by `tests/integration/queries-staging-seed.test.js`)
- [x] 11: `docs/manual/queries-and-sanctions.md` as a full chapter with its pictures, My Queries and a
  person's Queries and Sanctions tabs included (in this chapter, as M2 put My Performance in
  `performance.md`, so no other milestone's chapter changes); the user-guide gate passing without a
  trailer (27/10/2026)
- [x] 12: `queries.md` §13 cleared of what §4 settles; PROGRESS note (27/10/2026)
- [x] 12: `npm run ci` green on the committed merge; #22 ready for review (27/10/2026)
- [x] Approve Sanction and Reject on the query's card for whoever `queries.consequence` waits on
  (`POST /sanctions/:id/approve|reject`), Operations & People signing there (27/10/2026)
- [x] The afternoon decisions (§2): the Attendance policy raises its queries (`3040`), 24 hours,
  Caution, one suspension without pay with the CEO, MyCity's wording, Queries This Month, Edit Rule
  (27/10/2026)
- [x] User Guide: the chapter and the review section updated for the above, pictures retaken
  (27/10/2026)

---

## 6 · Notes

- Migrations `3010` and `3190` were never merged, so this branch edits them (the `fine` purpose,
  the `low_performance` trigger, the letter rows). `3020` (signatures) and `3030` (policy) are new.
- In other owners' areas: TB's `policies.service` gains read-only `citable()` and `citation()`;
  the shared letterhead is a table so its header and footer repeat, and prints the signer block
  (every letter).
- Write With AI's real wording is unchecked: the tests use the stub and the demo build gives canned
  drafts. Check it once a provider is set on staging.
- Jest runs every suite in one process, and its memory grows past the default 2 GB heap, so run it
  locally with `NODE_OPTIONS=--max-old-space-size=4096`. GitHub's runners are fine.
- The browser gates need `MYCITY_CHROMIUM=/opt/pw-browsers/chromium` in a cloud session.
- Not this branch: the Knowledge Hub's duplicate Announcements tab is to be removed.
- The demo build (the in-browser mock) lacked `queries.configure`, so nobody there saw New Rule,
  Add Step or New Template; it now holds it for Operations & People, as seed 3190 does. Its staff
  account (Kemi) has two queries, one closed with a Warning, for My Queries' pictures.

---

## 7 · Log

- 26/10/2026 · GE · Step 0 and items 1 to 9 built and pushed, one commit each, `npm run ci` green
  before each push.
- 27/10/2026 · GE · Item 10 built; main merged; PROGRESS #13 Built, #34 to #37 dated; draft PR #22
  opened; this handoff written for Victor.
- 27/10/2026 · AJ · §4 agreed with GE: six points as built, a Clause added to the rule form; the
  chapter goes in #22; the staging seed carries the rungs and a rule; the three awaited letters stay
  Needs a Letter.
- 27/10/2026 · AJ · Main merged again (#21, #24 to #26); the generated contract regenerated and 32
  stale pictures retaken. The chapter written with 20 pictures; the demo's `queries.configure` and
  Kemi's queries added. Found: no screen approves a proposed sanction. The staging seed waits on the
  two sample letters.
- 27/10/2026 · AJ · The afternoon decisions (§2): built together, guide first; see PROGRESS.
- 27/10/2026 · AJ · Staging seed `50_queries.js` and redacted letter samples; the User Guide
  updated (Approve or reject a sanction, Change a rule, 24 hours, Queries This Month) and pictures
  retaken. Nothing committed. Left: the Clause (AJ), `npm run ci` on the committed merge.
- 27/10/2026 · AJ · The rule form's Clause built (guide §6.3), tested in `queries.test.js` and
  `Queries.test.tsx`; User Guide steps added. Nothing committed.
- 27/10/2026 · GE · Audit of the branch at 66dc438 (§8): four blockers, the repository's visibility among them.
- 27/10/2026 · GE · §8 fixed: a sanction decided only on its card and never by the person queried, the
  approver checked before the signature is kept, the CEO by the rung's effect, the letter kept at
  proposal, `signed_by` RESTRICT and indexed, the breach locked, the letterhead's For line, 3099's
  types retired, the staging seed on the Implementation department's accounts (TB).
- 27/10/2026 · GE · §8 screens fixed: Evidence on Record Decision, Raise a Query gated and on ⌘K, the
  card read again after Approve Sanction with the right toast, Not Approved, ESS Respond's errors,
  the phone layout and Escalated's help, Rules' empty and error states; 35 pictures retaken.
- 27/10/2026 · GE · §8 documents fixed: MILESTONES §8 records the ratified ladder, approvers and
  attendance triggers; §2 to §4 here struck through where superseded and §3 rewritten as built; the
  stale words (48 hours, six rungs, Question, all six letters MyCity's) and the manual's three
  slips corrected. Left: §8.1's public repository (the owner's call) and the nits in §8.3.
- 27/10/2026 · GE · §8.3 fixed; main merged (#31); #22 rounded up and marked ready once `npm run ci`
  was green.

---

## 8 · Audit of 27/10/2026 (GE, at 66dc438)

The branch read end to end after AJ's merges: backend, data, screens and documents. Each finding was
checked against the code. Tick it here when fixed, with the commit.

### 8.1 Blockers

- [ ] **The repository is public** (GitHub reports `visibility: public`), and `seeds/staff/staff-list.xlsx`
  (MyCity's real staff) is on `main`. `README.MD` says private. Make the repository private or move
  the sheet out, then clean its history. Outside M3; the repository's owner decides.
- [x] **The queried employee can approve or reject their own sanction.** `sanctions.service.propose()`
  opens `queries.consequence` without `exclude_employee_ids: [query.employee_id]`, so a queried
  member of Operations & People decides their own. Pass it, and refuse it in `pendingFor`.
- [x] **A sanction can be approved unsigned.** It is listed in My Approvals, and
  `POST /workflow/instances/:id/approve` decides it without the Operations & People signature
  (`signed_by` stays null; the letter goes out with no signature). Reject there also skips the
  10 character reason. Refuse `queries.consequence` on the generic workflow routes (decided on the
  query's card only), and have `settle()` refuse to issue without `signed_by`. Guide §5's closing
  note still names the generic routes.
- [x] **Rungs that require evidence cannot be proposed.** Record Decision has no Evidence field, the
  service answers 422 `EVIDENCE_REQUIRED` on `evidence`, and the form shows nothing. The staging seed
  sets it on Suspension Without Pay and Dismissal or Termination. Add the field (or drop the flag),
  show field errors without a field as a toast, and fix the manual's "Add it" row.

### 8.2 Should fix

- [x] **Who approves follows position, not the rung.** `rank: step.position` with `rank >= 4` sends
  the CEO whatever sits fourth; adding or leaving out a rung moves it. Key the condition off the
  rung's `financial_effect` (3190 and `DEFAULTS` together).
- [x] **The ladder against MILESTONES §8** (binding). The documents call Caution, Warning, Second
  Warning, Suspension Without Pay, Dismissal or Termination "MILESTONES' order"; §8 has Caution,
  Warning, Suspension, Suspension Without Pay, Dismissal. The attendance triggers moved off Rules
  too. Record the ratification in MILESTONES §8, as §18 did for Departments.
- [x] **The staging seed raises disciplinary records against MyCity's real staff, and staging mails
  them** (query letters, sanction notices). Get TB's or MyCity's yes, or seed a demo employee, or
  hold the mail for seeded records. *Fixed: TB chose our accounts (27/10/2026); the seed queries the
  Implementation department's people only.*
- [x] **A sanction can stick in Pending Approval.** If Chain Settings points the rung at a draft
  letter after the proposal, `settle()` throws `LETTER_NOT_READY` in the outbox for ever. Keep the
  letter's key on the sanction at proposal.
- [x] **After Approve Sanction the card is stale and the toast wrong.** The sanction settles in the
  outbox, so the response is still pending: "Approved, sent on to the CEO" shows for a Caution, and
  the card stays Escalated until a reload. Choose the toast from `waiting_on`, refresh again after
  the worker, and have the mock settle late so a test sees it.
- [x] **A rejected sanction still reads as the query's Sanction** on the card.
- [x] **Raise a Query is shown to people the API refuses** (the employee role's `queries` view, own
  scope). Gate it on `queries create`; add `raise_query` to ⌘K (it is not findable).
- [x] **A failed ESS response says nothing** (`ess/Queries.tsx`: the catch reads the old render's
  fields). Use the `failed(f)` pattern.
- [x] **Phone layout against guide §10.2:** four KPIs stacked (two asked for), Queries by Reason and
  Recent Firings shown (left off). Escalated has no help term (§10.1).
- [x] **`sanction.signed_by`** (3040) has no ON DELETE and no index.
- [x] **The signature is stored before the approver is checked**, leaving an orphan file on a 403.
- [x] **`raiseFromBreach` does not lock the breach**: two deliveries at once spend a QRY number.
- [x] **The letterhead's signer block** has no "For" line, as guide §6.4 says it has.
- [x] **This handoff's §2 to §4 still describe the superseded design** (48 hours, proposer signs,
  Management from Suspension, six rungs, the attendance triggers on Rules). Strike them through.
- [x] **Stale words elsewhere:** `templates.assist.js` tells the model "Warning, Question"; `ess.md`
  §10.1 says 48 hours; the demo's knowledge article says 48 hours; guide header and §13 say six
  rungs; guide §4 leaves 3040 off `sanction`; three files say all six letters are MyCity's wording
  (the deduction letter is ours).
- [x] **The manual:** rule-raised queries are seen by everyone with scope all, not only Operations &
  People and the CEO; My Queries' Under Review is not "or the time has passed" (Respond stays open);
  `people.md` lists a record's tabs without Queries and Sanctions.
- [x] **3099 still seeds a six-rung `sanction_type` list on production** (unused). Set it inactive in 3190.

### 8.3 Nits

All fixed 27/10/2026 (GE), except the last, which is a note:

- [x] Dead code for the moved attendance triggers: the `minutes` measure, the lateness labels, "Comes
  with M2" on an old lateness rule.
- [x] Mock: a re-proposed sanction's id, one reminder a day, a fine's letter and the proposed dates
  kept on approval, Queries by Reason per rule.
- [x] Employee 360's status words match the Queries screens; raised dates show the Lagos day.
- [x] Rules: empty and error states, a pager, Activate only for what is counted, Edit Rule shows a
  fired rule's trigger fixed (`has_fired`); no made-up policy version.
- [x] `next_step` counts only the sanctions the reader may see; a team scope never reads a sanction's
  approval by id.
- Local databases that ran the earlier 3190 need a rebuild (`migrate.js` refuses the changed file).

---

## 9 · Sequel: Letter Templates and Sanctions (GE, 27/10/2026, evening)

#22 merged. GE's observations on staging, and the decisions taken on them (binding; do not ask
again). MyCity's Ops documents (letters, handbook, staff lists) were read for the layout; they hold
real names and never enter this public repository.

### 9.1 Observations

1. Editing a shipped letter opened an empty editor: its wording is an HTML file, and the API gave
   `body_html` only for Markdown wording.
2. Nowhere to keep a signature: each raise and approval draws one.
3. Used For cannot be chosen when editing; Used By is set from Chain Settings, and a rule cannot
   name a letter at all (the API takes `letter_template`; the form had no field).
4. Activate shows only on a draft; there is no Deactivate.
5. The preview is drawn on screen, not the PDF sent; the deduction letter's preview had no amount.
6. The preview cannot be downloaded.
7. Issue Sanction sent the reader to the Queries tab.
8. New Template saved a draft with no choice to activate it.

### 9.2 Decisions (GE, 27/10/2026)

- **Saved once, reused.** Each person keeps My Signature (Edit Signature on Letter Templates). Raise
  a Query and Approve Sanction start from it (redraw allowed); the preview shows it.
- **Deactivate when unused.** Activate a draft; Deactivate an active letter back to draft only while
  no step or rule uses it, else the refusal names what does.
- **The samples' layout, our header.** Body and sign-off as MyCity's samples (date, recipient block,
  bold capitals title, Yours faithfully, FOR: MYCITYAPP LIMITED, signature, name, role), keeping the
  logo header and the footer with page numbers. The preview is that PDF, downloadable.
- Used For may change while nothing uses the letter. Issue Sanction picks the query in place.

### 9.3 Checklist

- [x] S1 Letter editing: shipped wording in the editor (converted to Markdown on first save); Used For
  while unused; Deactivate when unused; New Template's Save Draft and Save and Activate; the rule
  form's Letter
- [x] S2 My Signature: migration `3050`, stored through the vault, Edit Signature, Raise a Query and
  Approve Sanction start from it, the preview shows it
- [ ] S3 The samples' layout in every M3 letter; the preview is the rendered PDF with Download; the
  deduction letter's sample amount
- [ ] S4 Issue Sanction picks the query on Sanctions; guide, chapter, pictures, PROGRESS, `npm run
  ci`, the PR

### 9.4 Log

- 27/10/2026 · GE · Observations read against the code, decisions taken, branch restarted from main.
- 27/10/2026 · GE · S1 built: the editor opens a shipped letter's wording, Name and Used For on Edit
  Template, Deactivate while unused, Save Draft and Save and Activate, the rule's Letter.
- 28/10/2026 · GE · S2 built: Edit Signature, `letter_signature` (3050), the pads open with it. The
  preview signing with it comes with S3.
