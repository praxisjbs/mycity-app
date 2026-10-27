# M3 Queries & Sanctions · Build Handoff

**Start here if you are continuing this work.** This file is self-contained: what the 26/10/2026
meeting asked for, the decisions GE took (do not ask them again), how each screen works as built,
the points still to agree with Victor, the checklist with its status, and a dated log. The design
itself is `docs/guides/queries.md`; this file is the build plan and its log.

| | |
|---|---|
| Branch | `m3/queries-sanctions` (push only here; the PR targets `main`) |
| Pull request | #22, draft |
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

1. **The Question rung sits after the Warning.** The ladder is Warning, Question, Second Warning,
   Suspension, Suspension Without Pay, Dismissal or Termination.
2. **Write With AI's jobs:** `query-draft` on Default, `letter-draft` on Deep Reasoning. Both are
   registered in `src/services/ai/actions.js` with `chosen_by: "GE"`, personal data.
3. **Nothing is kept until Use Draft.** When AI is off or this month's budget is spent the button
   says so (AI Is Off, AI Limit Reached) and the form works as before.

---

## 3 · How each screen works (as built)

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
in the app and by email, the query letter is made, and they have 48 hours to respond.

### 3.2 Queries (Queries & Sanctions · Queries)

- Operations & People, Management, Implementation and the CEO see every query. Anyone else sees only
  the queries they raised, even within their own team. A rule's queries are seen by the first group only.
- KPI strip (Open, Awaiting Response, Closed This Month, Escalated), the **All Queries** and
  **Raised by Me** chips, the list. A picked row opens beside the list: subject, raised by, raised,
  response due, the policy cited, the days a rule counted, the response, the sanction.
- **Send Reminder** once a day while a response is awaited; **View Letter**; **Record Decision**.
- Phone: two KPI cards, query cards with a status pill, a tapped card in a bottom sheet with
  **Record Decision** at its foot; **Raise a Query** full width.

### 3.3 Record Decision

- Needs `queries` edit; the person queried never decides their own. Before the 48 hours end it needs
  the response; after, it does not.
- **Close, No Action:** a reason of at least 10 characters; the query is resolved.
- **Sanction:** the rung (the next one marked Next; only rungs whose letter is ready), dates for an
  unpaid suspension, an optional fine, the reason and the proposer's signature. It opens the
  approval, and the query shows Escalated until it is decided.
- Approval: Operations & People on every rung, Management as well from Suspension up. A refusal
  sends the query back under review.

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
- A query letter is signed by its raiser; a rule's query is signed Operations & People. A sanction
  letter is signed by its proposer (name, job title, drawn signature).
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
deleted. "N offences in D days raise one query", the counted days or tasks as its evidence.

| Trigger | What counts |
|---|---|
| Late Arrival | A late clock-in; may count late minutes instead |
| Absence | A working day closed as absent |
| Missing Clock-Out | The day-close found none |
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
- [ ] §4 agreed with Victor
- [ ] 11: demo queries and sanctions in the staging seed only, never production
- [ ] 11: `docs/manual/queries-and-sanctions.md` (empty now) as a full chapter; the My Queries section
  of `employee-self-service.md`; the Employee 360 sections of `people.md`; their pictures
  (`npm run guide:shots`); the user-guide gate passing without a trailer
- [ ] 12: `queries.md` §13 cleared of what §4 settles; PROGRESS note; `npm run ci`; #22 ready for review

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

---

## 7 · Log

- 26/10/2026 · GE · Step 0 and items 1 to 9 built and pushed, one commit each, `npm run ci` green
  before each push.
- 27/10/2026 · GE · Item 10 built; main merged; PROGRESS #13 Built, #34 to #37 dated; draft PR #22
  opened; this handoff written for Victor.
