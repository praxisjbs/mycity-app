# Praxis AI Engine · Build Handoff

**Start here if you are building any pull request of the Praxis AI Engine in a new chat.** This
file is self-contained: the handover document checked against the code, the decisions taken (do not
ask them again), the design in one page, the five pull requests with their dependencies, the full
prompt each new chat starts from, the progress checklist of every PR, the gates the work adds, and a
dated log. The feature itself is designed in `docs/guides/praxis-ai.md`; this file is the build plan
and its record. It follows the shape of `docs/handoff/notifications-everywhere.md`.

| | |
|---|---|
| Branch | One branch per PR, from the latest `main` (§4). PR1 was built on `claude/engine-upgrade-guide-xf4ynp` |
| Pull requests | PR1 praxisjbs/mycity-app#49, merged 01/11/2026; PR2 praxisjbs/mycity-app#50, merged 01/11/2026; PR3 praxisjbs/mycity-app#51, merged 01/11/2026; PR4 praxisjbs/mycity-app#53, merged 01/11/2026; PR5 praxisjbs/mycity-app#56, merged 01/11/2026; after PR5, seamless tasks and meetings praxisjbs/mycity-app#57, merged 02/11/2026; documents in the chat, PR 1 praxisjbs/mycity-app#144, merged 13/11/2026, and PR 2 praxisjbs/mycity-app#146 (§6.11); charts in the Overview, eight PRs planned in `praxis-ai.md` Appendix B (§6.12) (§6 holds each PR's state) |
| Owner | JBS Praxis (the owner), with TB and GE as the module's owners |
| Type | Full stack (CLAUDE.md step 1): backend, contract, migrations, screens, gates and documents |
| Started | 01/11/2026 |
| Source | The handover *Praxis AI Engine* of 01/11/2026 (eleven decisions agreed with the JBS Praxis owner), checked in §1 |

---

## 0 · How to continue

1. Read this file in full, then `docs/guides/praxis-ai.md` in full (its §1.1 holds every decision,
   1 to 9 from October and 10 to 27 from this plan), then what CLAUDE.md step 2 asks for full-stack
   work: `docs/BACKEND_GUIDE.md`, `docs/BACKEND_STRUCTURE.md` §14 and §16, `docs/MIGRATIONS.md` if
   you write a migration, `docs/FRONTEND_GUIDE.md`, `docs/FRONTEND_FOUNDATION.md` §3 and
   `docs/COMPONENTS.md` before any screen, `docs/guides/ai-control.md` §6, and
   `docs/manual/praxis-ai.md` with `docs/manual/README.md` before you change a screen.
2. Find your PR in §4 and its prompt in §5. Check §6 that the PRs it depends on are merged.
3. Build its checklist in §6 top to bottom. Tick each item with the date as you go, add a line to
   §8, commit and push often: a session can end mid-task.
4. Never re-open §2. The owner decided every point on 01/11/2026 and the challenges in §1 were
   resolved into those decisions. A genuine blocker the guide does not settle is one
   AskUserQuestion, the recommendation first, and the answer goes into §2 here and
   `praxis-ai.md` §1.1 and §14.
5. Work in the foreground. No background agents or workflows unless the person asks. Open the PR as
   a draft; mark it ready when the whole `npm run ci` is green locally; the author merges with
   Squash and merge once CI is green on GitHub (BACKEND_GUIDE §8.5). Never a model id in commits, PR
   text or code; never a donor project's name anywhere (`scripts/check/provenance.js`).

---

## 1 · The handover document, checked

The handover of 01/11/2026 was read against `praxisjbs/mycity-app` at `5ec33ac` (31/10/2026). Each
claim is marked **true**, **false** or **challenged**; a challenge names the rule it collides with
and what this plan does instead. The decisions that came out are §2.

### 1.1 What it says about today, and what the code holds

| Claim | Finding |
|---|---|
| Ask with Recent beside it, History, the floating button on a phone | **True.** `app/src/features/assistant/{index,Conversation,PhoneChat,AskPanel}.tsx`; PROGRESS #67 and #68 Built |
| Short text, a table drawn from the rows, From as kinds of record, a screen button | **True.** `services/ai/assistant/answer.js`; `praxis-ai.md` §6.4 and decision 9 |
| A change opens the right form, prefilled; the person saves there | **True.** Routes with `prefill` schemas (`TaskPrefill`, `CalendarEventPrefill`, `LeaveRequestPrefill`, `EmployeePrefill`), `useAddressPrefill` |
| Up to 5 manifest reads; 25 rows a page with the total; 12,000 characters to the model | **True.** `orchestrator.js`: `MAX_READS = 5`, `RESULT_MAX_CHARS = 12_000`; `authorise.assertPage` |
| Grant, scope and field mask on every read; identity numbers always removed | **True.** `shared/ai/authorise.js` steps 1 to 7; `redact.js` `NEVER_PROPS` |
| No export from an answer | **True.** Only History's Export exists (`assistant.export.js`) |
| Built inside MyCity, `services/ai/assistant` and `shared/ai/*` | **True** |
| Decision 3 of `praxis-ai.md` §1.1 says "it answers, it never acts" (A23) | **True.** `manifest.js` refuses `actions`, gate 19 (`ai-no-writes.js`) fails the build on one |
| Tables `ai_conversation`, `ai_message`, `ai_message_citation`, `ai_run`, `ai_run_step` | **True** (`10000`, `10310`, `0095`) |
| "Supersedes the AI parts of `docs/MYCITY_DEMO_GAPS.md`" | **False.** No such file exists in the repository. Nothing to supersede; the decisions stand on their own |
| "The Mailbox was declined by MyCity (Change Report 01): no mail actions are declared" | **False.** There is no Change Report 01. The Mailbox is built (M1, `docs/guides/mailbox.md` Status Built, PROGRESS #18 to #23 and #94) with Write With AI, Tidy Up, Dictate and Summarise Thread. What stands is `mailbox.md` §9: Praxis AI reads no mail (`// ai:none` in its controller). A mail *action* contradicts nothing: the person presses Send. Decision 19 |
| The PIN fallback is an open point: "confirm it can sign a step-up for an API call" | **Answered.** It can. `POST /security/confirm` takes the password, the PIN or a passkey and marks the session (`user_session.reauthenticated_at`); a route past its window answers 403 `REAUTH_REQUIRED` and the screen's `useFreshSignIn` asks Confirm It's You and runs the call again (`identity.md` §1.1 decision 13). Decision 11 reuses it with a five-minute window |
| The 12,000 character cut becomes "summary + at most 50 rows" | **Challenged** (§1.2 item 3) |

### 1.2 The challenges, and how each was resolved

1. **A separate repository and four packages** (`jbspraxis/praxis-ai-engine`, `@jbspraxis/ai-core`,
   `ai-react`, `ai-node`, a Laravel adapter). This session reaches only `praxisjbs/mycity-app`, and
   the repository's rules forbid a second copy of a shared concern: one design system in
   `packages/ui` (F1, F11), one contract in `packages/contract`, one AI client in `services/ai`. A
   React package beside `@mycity/ui` would be exactly the second copy the gates refuse. **Resolved
   (decision 17):** the engine is built here as a boundary, not a repository: `src/services/ai/engine/`
   holds the pure engine (the turn loop, cards, pane, matrix) with every MyCity dependency injected
   through one `createEngine(deps)`, and gate 24 (`check/ai-engine-boundary.js`) fails any file in
   it that requires anything outside Node's builtins and its siblings. The React views live in
   `packages/ui` as a group of their own (Assistant), themed by tokens like every other component.
   Extracting the folder and the group into their own repository is one later PR in that
   repository, after PR5; the PHP adapter and HQ are out of this plan.
2. **Renaming the tables** (`ai_message` to `ai_turn`, a new `ai_turn_read`, `ai_action_draft`,
   `ai_action_run`, `ai_export`; "one migration maps the current tables onto these"). A rename under
   running code is forbidden (`docs/MIGRATIONS.md` §8: add, copy, drop later) and gains nothing.
   **Resolved (decision 18):** the existing tables stay; `10330_praxis_engine.sql` adds
   `ai_message_read`, `ai_action_draft` and `ai_action_run`, widens `ai_catalogue.kind`, and adds
   `ai_conversation.opened_from` and `ai_message.context`. An Excel file is a `document` reserved by
   the one export path, so there is no `ai_export` table.
3. **50 rows a page, 200 in the pane, 50 to the model.** The one rule of the repository is 25 per
   page, server side, everywhere, the AI included (CLAUDE.md step 4; BACKEND_STRUCTURE §16; gate
   `pagination.js` fails a page size anywhere). **Resolved (decision 14):** pages stay 25. The model
   sees each read's summary figures and its first page of 25, and asks for a later page as a read of
   its own, within the five reads. The pane's Table pages at 25 like every list, up to 8 pages (200
   rows); past that it says how many rows there are and offers Excel. "The AI sees at most 50 rows"
   is then two pages of one read, which the five-read cap already allows.
4. **Excel "instant up to 5,000 rows, streamed from the request".** Every file a person presses
   Export for goes through one path: reserved in the request, built in the worker, downloaded on the
   device, kept 24 hours (`docs/guides/foundation.md` §6.12; "never built inside the request").
   **Resolved (decision 15):** every answer export takes that path. The app's wait polls at once and
   then every few seconds, so a small file lands in seconds; nothing is streamed from a request. The
   cap is 25,000 rows (one constant), more than a year of MyCity's attendance and more than the
   Audit Log's own export; 100,000 rows is not a size any MyCity list reaches and would need a
   streaming writer for no reader.
5. **Streaming answers.** No vendor file streams today, and five providers with tools would each
   need it. On a weak Lagos connection a whole answer saved once and replayed by its
   `Idempotency-Key` is what survives a dropped socket (`praxis-ai.md` §11). **Resolved (decision
   23):** the text arrives whole; while the question runs the screen shows progress ("Reading leave
   requests", "Reading 2 of 5") over the realtime channel the bell already uses, best effort. The
   question stays open in `praxis-ai.md` §13.
6. **Prompt caching as "a stable prefix".** Only Anthropic's API takes an explicit cache mark; the
   first choice on Data Answers is Gemini's Flash, which caches implicitly. **Resolved (decision
   24):** the system turn (the prompt, the person's catalogue of reads, summaries and actions) is
   built once per question in a fixed order and marked cacheable where the vendor takes a mark
   (Anthropic's `cache_control` on the system block); the question and the reads' results follow it.
   No new state.
7. **Six PRs and 43 days, E6 switching MyCity over and proving the PHP adapter.** The owner asked
   for five heavy PRs. **Resolved (§4):** E1 is PR1, E2 is PR2, E3 is PR3, E4 is PR4, and E5 with
   the MyCity half of E6 is PR5. HQ is not in this repository.
8. **"Every module is connected: Mail, Direct messages, Proposals, Partnerships, Goals".** Mail,
   Staff Community, Workspace, Leave, Approvals and Performance (goals, KPIs, reviews) are built.
   Partnerships and Proposals (M7), Recruitment (M4), Offers (M5), Payroll (M6) and Expenses (M8)
   are **Not started** (PROGRESS summary), their manifests empty. **Resolved (decision 21):** an
   action belongs to its module's manifest beside its reads, so Praxis AI reaches a module the day it
   ships its manifest, with no change to the engine. PR4 declares actions for every built module
   that has a write a person would ask for; a later milestone declares its own in the same PR that
   builds its screens, and gate 23 asks it to (§7).
9. **Which job the new work runs on.** CLAUDE.md asks the person before a new AI feature is built.
   Nothing here is a new feature: the pane, the summaries and the action drafts are more of the
   same question, answered in the one Data Answers run (Default job, Gemini Flash then Pro, with any
   text model IT chooses). **Assumption recorded (decision 25):** no new action is registered; the
   nightly attack run is Data Answers too. If the owner wants the action draft on Deep Reasoning, it
   is one `chain` line on a registered action, not a design change.

---

## 2 · Decisions (01/11/2026, binding)

Numbered after `praxis-ai.md` §1.1, which holds 1 to 9. These are written there too; here with the
reason and the PR that builds each.

10. **The AI acts only through a declared action a person confirms** (replaces decision 3 and the
    "never writes" reading of A23; MILESTONES §15 carries the amendment). The model proposes an
    action and its values; the server validates them against the action's contract schema, checks
    the person's rights, stores the card and shows it; the person's press runs the module's own
    service function, once, with their own rights, re-checked at the press. The model never calls an
    API, never sees a service, and its words never say something was done before the result line
    says so. PR1 (the lifecycle), PR4 (the actions and the cards on screen).
11. **One press for `standard` actions. `approval`, `money`, `payroll` and `delete` need Confirm
    It's You within the last five minutes:** a passkey first when the person has one, else the PIN,
    else the password, through the existing `POST /security/confirm`; the confirm answers 403
    `REAUTH_REQUIRED` past the window, exactly as My Security does. A person without a passkey is
    offered Set Passkey once on the full-screen Praxis AI. PR1 (the check), PR4 (the sheet).
12. **Full screen from any screen, with Back.** The Praxis AI button on every screen, ⌘K and its
    own menu item open it full screen; the screen it was opened from travels with the question as
    context (its module, tab, record id and filters); Back (button, Escape, the browser's and the
    phone's back) returns to that screen with its scroll and filters as they were. PR2.
13. **The right pane: Overview, Table, Record, Sources** (the sales video). Overview shows figures
    and one chart the server draws from a summary read; Table every row of one read, 25 a page,
    sortable where the read allows, each row opening its record, with Download Excel; Record the
    record behind a chip or a row, with the person's own field masks and Open; Sources every read of
    the turn with its filters, rows, total and outcome. Empty tabs show disabled so the layout never
    jumps. On a phone the pane is a sheet opened from the answer. PR2 (the pane), PR3 (Overview's
    figures and Excel).
14. **Pages stay 25; the model reads figures.** A module declares summary reads (count, sum,
    average, minimum, maximum, by group up to 20, top 10, by day, week or month) that run in the
    database with the person's scope. The model sees the figures, the total and the first page of 25
    of each read; it asks for a later page as a read of its own; five reads a question stand. The
    pane's Table pages at 25 up to 200 rows; past that, Excel. PR1 (the shape, the checks), PR3 (the
    summaries of the big tables).
15. **Excel through the one export path.** Download Excel reserves the file in the request, the
    worker builds it from the turn's recorded read with the person's current rights and masks, the
    device downloads it, the vault keeps it 24 hours. At most 25,000 rows. A second sheet, About
    This File, carries who exported it, when, the question, the read with its filters and row count,
    and the masks applied. PR3.
16. **The same rights everywhere, re-checked at the press.** Every read and every action is gated by
    code: the grant, the scope in the query, the field mask after, and at the press the grant, the
    scope on each record, the approval chain (nobody approves their own request) and the record's
    state (changed since the card was drawn: the card says so and is redrawn). Text inside a record
    is quoted data to the model and can never widen a read or run an action. PR1, PR4.
17. **The engine is a boundary, not a repository** (§1.2 item 1): `src/services/ai/engine/` is
    pure and gated; MyCity's adapter is `services/ai/assistant/` and the `assistant` module; the
    React views are a group in `packages/ui`. Extraction into JBS Praxis's own repository is a
    later PR there, after PR5. PR1 (the boundary and gate 24), PR2 (the group).
18. **The existing tables stay; three are added** (§1.2 item 2): `ai_message_read` (each read of a
    turn, with its parameters, page, total and outcome, so a later page, the Sources tab and an
    Excel file are rebuilt without asking the model again), `ai_action_draft` (the card) and
    `ai_action_run` (its confirmation and result). PR1.
19. **Mail and messages are actions; Praxis AI still reads neither.** The model may draft a mail
    (to, subject, body) or a direct message to a colleague as a card from the records the person
    may see and the words they gave; the person presses Send; the mailbox sends it through its own
    queue with the company signature, Staff Community posts it through its own service. `mailbox.md`
    §9 (no mail read) and `community.md` §9 (no message read) stand: a reply to a thread is still
    Write With AI inside the composer. PR4.
20. **A suggested card.** After an answer the model may offer at most one action the person did not
    ask for ("Tell Ada her leave is approved?"), marked suggested, drawn and gated like any card,
    never run unasked. One card per answer, suggested or asked. PR1 (the shape), PR4.
21. **Actions live in the module's manifest, beside its reads.** `defineManifest` takes `summaries`
    and `actions` next to `reads` and `routes`; the engine knows nothing module-specific. An action
    declares its key, description, input schema (the form's own contract schema), grant, risk class,
    the records it touches, its re-check, the service function it runs and how it reads the result
    back. A module that declares no action yet keeps its routes: a prefilled screen stays the
    fallback. PR1.
22. **The engine is told when a form, a payload or a schema changes** (gate 23,
    `check/ai-awareness.js`, §7): the catalogue snapshot is committed and must be regenerated when a
    read, summary, action or route changes shape; an action's input schema must be the one the
    module's own form validates with; every action is exercised by an integration test and graded by
    the evaluation set; a module that declares actions accounts for every `<Thing>Create` schema in
    its contract, offered or not with a reason. PR1 (the gate), PR4 and PR5 (its coverage).
23. **No streaming; progress over realtime** (§1.2 item 5). PR2.
24. **The system turn is a stable, cacheable prefix** (§1.2 item 6). PR1.
25. **One AI action for the whole question** (§1.2 item 9): Data Answers, one run per question,
    its steps the rounds, its spend on AI Control · Spend as today. PR1.
26. **Proof in CI.** The matrix generated from the registry runs on every PR: every read, summary
    and action, every seeded role and the CEO, inside and outside scope where a module gives the
    matrix a probe; the attack suite runs on every PR with the model scripted and nightly with the
    real model on staging; a leak fails the build. PR1 (the generator and the scaffold), PR5 (the
    probes, the attacks, the nightly run, leak monitoring on AI Control).
27. **The old Ask retires in PR5**, once PR2 to PR4 are on staging: the full-screen Praxis AI is the
    one screen, History stays, the phone's floating button opens the same screen, the guide and the
    User Guide chapter are rewritten, and `praxis-ai.md` §2 and §10 describe only what ships.

**Decided after PR5 (JBS Praxis, 01/11/2026), on the branch `claude/determined-dirac-b4ivrd`.** The
owner tried a task card on staging: a task for JBS Praxis Team shared with TBO came back with codes
for names, "employee" for whom it was for, a problem ("People or a department") on a field Edit
could not change, and TBO made to share the task when they were asked to watch it. Three questions
were put to them, each with a recommendation first; they took every recommendation and ticked all
four of the details to ask for. `praxis-ai.md` §1.3 holds the decisions as written for the build:

28. **One question at a time, with choices to tap** (asked: one question with tap choices, all at
    once, or the card first with blanks marked). The tap is the person's next question, so nothing
    new is stored but the question's choices.
29. **What is always asked**: a task's title, due day and priority; a meeting's subject, day and
    start, length and who comes; which person when a name matches several (asked as a multiple
    choice: the due day, the meeting's length, its attendees and the task's priority were all
    ticked). The server's `asks` back the model up, once each in a run of questions, so a forgetful
    model cannot draw an incomplete card or ask in a loop.
30. **Watching gives sight** (asked: watching lets them see it, only people who can see it, or no
    watchers from the chat). It amends `workspace.md` §6's rule of 23/10/2026.
31. **A card names what it holds and edits every field** (the fix for what was seen, no question
    needed): `names` beside `records`, the verb counting only records acted on, Edit's pickers, the
    card's `fields`, and the share rule in the action's description.

**Decided 03/11/2026 (JBS Praxis), for Performance's, Staff Community's and Mailbox's forms**
(decision 33's next three modules, `praxis-ai.md` §1.9). Four questions were put to the owner, each
with a recommendation first:

40. **The check-in, scores, PIPs, announcements and signatures.** The monthly check-in: a card per
    line, saved to the draft through My Performance's own save (asked: one line per card, or never
    in the chat; the recommendation taken). A reviewer's scores and improvement plans: both cards,
    each press behind Confirm It's You (asked: scores in the chat and PIPs never, recommended; both
    behind Confirm It's You, chosen; scores alone behind it; both never). Announcements: one press, as
    the screen's own button (asked: one press, recommended and taken; Confirm It's You first; never).
    Signatures: both cards in full, the mobile included (asked: both without the mobile, recommended;
    both in full, chosen; Configure only). Neither signature carries an image, so the `file` reason
    does not apply.

---

## 3 · The design in one page

What the five PRs build, with the section of `praxis-ai.md` that holds the detail.

### 3.1 One question (§6.1, §6.11)

```
POST /ai/ask { question, ai_conversation_id?, context?, shows? }
  governance     AI on, Praxis AI on, the cap (as today)
  system turn    the prompt (version 4), who is asking, today, the screen they came from (context),
                 the screens they may open, the routes, the ACTIONS they may draft (key, description,
                 fields from the input schema), the answer's JSON Schema; built once, fixed order,
                 marked cacheable where the vendor takes a mark
  tools          one per read and per summary the person may run (authorise.allowedReads,
                 allowedSummaries); nothing else
  loop           engine/turn.js: rounds, at most 5 reads, a repeat or the limit forces the answer,
                 one correction, then the plain-words rescue (as today, moved behind the boundary)
  draft          AiAnswerDraft: text, table, route, prefill, more, and now action { key, values,
                 suggested } or null, overview { summary, figures, chart } or null
  build          answer.js: the table from the read's rows, the link from a route, citations and
                 From as today; the PANE: sources from every read made, overview from the summary
                 named; the CARD: engine/cards.draft validates values with the action's schema,
                 drops what the person may not set, fills from the context, lists the records,
                 marks problems the person must fix
  save           one transaction: the question, the answer, its citations, each read as
                 ai_message_read, the card as ai_action_draft (30 minutes), emit assistant.answered
  reply          AiAnswer, with card, context and reads (n, key, params, outcome)
```

Only a screen that says `shows: ["cards"]` is offered actions; one that says `"pane"` gets the
pane's specs. The screens of today say neither, so nothing they show changes until PR2 and PR4.

### 3.2 A card (§6.11)

```
GET  /ai/cards/:id                    the card as the person sees it (own)
PUT  /ai/cards/:id      { values }    edited values, re-validated, problems updated
POST /ai/cards/:id/confirm { values? }  Idempotency-Key; the press
      1 the card is shown and not expired (409 CARD_EXPIRED, CARD_DONE, CARD_RUNNING)
      2 risk approval, money, payroll, delete: the session confirmed within 5 minutes
        (403 REAUTH_REQUIRED; the screen asks Confirm It's You and presses again)
      3 authorise.checkAction: the grant and scope now, the values parse, at most 25 records
      4 the action's own check(client, values, actor): each record in scope and in the state the
        card saw, no self-approval (a module rule, written once in the module)
      5 ai_action_run opened (running), then run(values, actor with scope, { idempotency_key })
        through the module's service, which keeps its own transaction and emit()
      6 the run closed done with readback lines per record, or failed with the error, and the
        card's status set; emit assistant.action_confirmed, with the card, how it was confirmed
        and the result, never the question's words
POST /ai/cards/:id/cancel             the person declines; the card is cancelled
```

A card is the person's own; nobody else can see or press it. An expired card is refused and the
answer offers to draw it again.

### 3.3 Reads replayed (§6.12)

`GET /ai/answers/:id/reads/:n?page=2` runs read `n` of answer `id` again with the stored parameters
and the person's rights *now*, so the Table's later pages, the Sources tab and the Excel file come
from the records, not from the model, and a person who lost a grant since sees nothing more.

### 3.4 Summaries (§6.13)

A summary read returns `AiSummaryResult` (figures, groups, series, a total), never rows; `authorise`
refuses one that returns rows. The model names the summary its Overview rests on and up to three
figures and one chart (bar, stacked bar, line, donut) with a sentence title; the server draws the
chart from the summary's own groups or series and drops a title that names a value the summary does
not hold.

### 3.5 The screens (§2, §10; PR2 and PR4)

The full-screen Praxis AI (`praxis_ai.ask`, reshaped): the conversation on the left (about 40%), the
pane on the right (about 60%), Back in the header with the name of the screen it returns to, Recent
behind a toggle; on a phone the conversation full width, the pane as a sheet from Open Figures. An
answer is two to four sentences with source chips; a card is a bordered card in the conversation
with its fields, the records it touches, and its buttons (the verb and the count, Edit, Cancel). The
result line sits under the card. History is unchanged.

---

## 4 · The build: five pull requests

| PR | Name | Branch (new chat) | Scope | Depends on | Done when |
|---|---|---|---|---|---|
| **PR1** | Engine core | `claude/engine-upgrade-guide-xf4ynp` (this session) | Decisions 10, 14, 16 to 18, 21, 22, 24, 25 as code: manifest v2 (summaries, actions), registry and catalogue snapshot, authorise for summaries and actions, the engine boundary and gate 24, the card lifecycle with the five-minute confirm, read replay, migration 10330, the contract, prompt version 4, the matrix generator, the attack scaffold, gate 19 rewritten, gate 23, the documents | nothing | Every manifest loads unchanged; `tasks.create` is drafted, confirmed and a task exists, in an integration test on the real migrations; a replayed, expired or forbidden card is refused; the matrix passes for every read on every seeded role; gates 19, 23 and 24 are in `npm run ci`; nothing a person sees changes |
| **PR2** | Full screen and the pane | `claude/sharp-planck-z0g9va` (praxisjbs/mycity-app#50) | Decisions 12, 13, 23: the full-screen Praxis AI with Back and context, the Assistant group in `packages/ui` (conversation, chips, the four pane views, charts, the phone sheet, progress), Table paging through read replay, Record, Sources; the User Guide chapter and pictures | PR1 | Every pane view works on desktop and at 375 px, light and dark; Back returns to the exact screen with its filters; progress shows while reads run; the old Ask's tests moved onto the new screen; gates 8, 11, 21 green |
| **PR3** | Large data and Excel | `claude/clever-pasteur-nt3rsc`, praxisjbs/mycity-app#51 (merged 01/11/2026) | Decisions 14, 15: summary reads for attendance, tasks, leave, approvals, performance, the Audit Log and employees; the statement timeout and the narrow-down answer; Overview's figures and chart; Download Excel with the provenance sheet through the export path; the summary cache | PR1 (runs beside PR2) | A 25,000-row export completes in the worker and downloads; a read that would scan too much asks to narrow; the model never receives rows from a summary (asserted); Overview shows a chart the server drew |
| **PR4** | Action cards | `ccr-e4d934cb-hbbhlg` (the session's), praxisjbs/mycity-app#53 (merged 01/11/2026) | Decisions 10, 11, 19, 20, 21: actions declared in Workspace (tasks, calendar), ESS and People (leave request, approve, reject), Approvals (decide), Staff Community (message a colleague, post in a channel), Mailbox (send a mail), Performance (a check-in note where the service allows); the card on screen with Edit, Cancel and the confirm sheet (passkey, PIN, password); bulk up to 25; suggested cards; per-module `not_offered` accounting | PR1 and PR2 | Approve 4 leave requests from the chat works with a passkey and with a PIN; a card replayed after rights were removed is refused; "Tell Ada" drafts a direct message the person sends with one press; a mail drafted from the chat arrives with the company signature; gate 23's action rules green for every module |
| **PR5** | Proof and switch-over | `ccr-0f62841c-d228ng` (the session's), praxisjbs/mycity-app#56 | Decisions 26, 27: scope probes per module in the matrix, the attack suite in CI and nightly on staging with the real model, refusal and leak monitoring on AI Control, gate 23's `not_offered` rule made universal, the old Ask retired, `praxis-ai.md` §2 and §10 rewritten to what ships, the User Guide chapter final, the extraction note | PR3 and PR4 | Every listed attack fails safely with the model scripted and with the real model; a planted leak fails the build; the nightly run alerts on a refusal that leaked; the guide and the manual describe one screen |

**Order.** PR1 first and alone. PR2 and PR3 start together the moment PR1 merges, in two chats. PR4
starts when PR2 merges (its card is drawn inside PR2's conversation; its backend half may start on
PR1 alone and rebase). PR5 starts when PR3 and PR4 are merged. Each PR branches from the latest
`main`; when two touch `contract.gen.ts`, never hand-merge it: take either side and run
`npm run gen:contract`.

**Files by PR**, so parallel chats do not collide:

| PR | Owns |
|---|---|
| PR1 | `packages/contract/schemas/assistant.js`, `migrations/10330_praxis_engine.sql`, `src/shared/ai/{manifest,registry,authorise,catalogue-sync}.js`, `src/shared/ai/catalogue.snapshot.json`, `src/services/ai/engine/*`, `src/services/ai/assistant/*`, `src/services/ai/prompts/data-answers.md`, `src/modules/assistant/*`, `src/modules/tasks/tasks.ai.js` (the reference action), `scripts/check/{ai-no-writes,ai-awareness,ai-engine-boundary}.js`, `scripts/gen/ai-catalogue.js`, `scripts/ai/eval-assistant.js` (the `action` grade), `tests/integration/{ai-matrix,ai-cards}.test.js`, the documents |
| PR2 | `packages/ui/src/assistant/*` (the Assistant group), `app/src/features/assistant/*`, `app/src/shell/*` (the way in and Back), `app/src/api/mock/modules/assistant.ts`, `docs/manual/praxis-ai.md` and its pictures; in the backend only `assistant.service.js` (progress events) and `assistant.events.js`. As built it also touched, and said so: the controller (the `Idempotency-Key` handed to the service), one `onRead` hook in the orchestrator, and two fields on the contract (`AiReadMade.masked`, `AiAnswerTable.read`) so the Sources and Table panes have what they show |
| PR3 | `src/modules/<module>/<module>.ai.js` for the summaries (attendance, tasks, leave, workflow, goals, kpis, reviews, audit, organisation), `packages/contract/schemas/<module>.js` (their query schemas), `src/modules/assistant/assistant.export.js` (the answer export), `src/shared/ai/authorise.js` (the timeout), `services/ai/engine/pane.js` (Overview), `packages/ui/src/assistant/Overview*.tsx` only after PR2 merged |
| PR4 | `src/modules/<module>/<module>.ai.js` for the actions, `packages/ui/src/assistant/Card*.tsx`, `app/src/features/assistant/*` (the card and the confirm sheet), `scripts/ai/eval-assistant.js` (action cases), `tests/integration/ai-actions-*.test.js` |
| PR5 | `tests/integration/ai-attacks.test.js`, `scripts/ai/attack-assistant.js`, `.github/workflows/ai-nightly.yml`, `src/modules/ai_governance/*` (refusals and leaks on Spend), the retirement of the old Ask, the final documents |

---

## 5 · Prompts for new chats

Each PR is built in a fresh chat from its prompt below. In the chat, one line is enough:

```text
Build Praxis AI Engine PR<n>. Your brief is the "PR<n>" prompt in docs/handoff/praxis-ai-engine.md §5; follow it exactly.
```

Every prompt begins with the same rules.

```text
COMMON RULES FOR EVERY PRAXIS AI ENGINE PR

You are building one pull request of the Praxis AI Engine in the MyCity App ERP (repository
praxisjbs/mycity-app). docs/handoff/praxis-ai-engine.md is the build plan and docs/guides/praxis-ai.md
is the design; together they are the single source of truth. Every decision in handoff §2 and guide
§1.1 was taken by the JBS Praxis owner on 01/11/2026, after the challenges in handoff §1 were put
to them: do not ask them again. If something genuinely blocks you that neither settles, ask once with
AskUserQuestion, your recommendation first, then record the answer in handoff §2 and §8 and in guide
§1.1 and §14.

Work in the foreground. Do not start background agents or workflows unless the person asks. Commit
small and push often: a session can end at any time, and pushed work is not lost. Put on the hat of
the principal engineer: every piece complete, tested, documented, and nothing left for "later" that
your PR's row in handoff §4 says is yours.

1. Branch from the latest main with the name your prompt gives (or the branch your session was
   given). Open the PR as a draft at once, with the template filled in.
2. Read, in this order: docs/handoff/praxis-ai-engine.md in full (§6 says where every PR stands);
   docs/guides/praxis-ai.md in full; docs/PROGRESS.md (Praxis AI, #67 and #68); MILESTONES §15;
   then CLAUDE.md step 2 for full-stack work: docs/BACKEND_GUIDE.md in full, BACKEND_STRUCTURE §14
   and §16, docs/MIGRATIONS.md if you write a migration, docs/FRONTEND_GUIDE.md,
   docs/FRONTEND_FOUNDATION.md §3 and docs/COMPONENTS.md before any screen, docs/guides/ai-control.md
   §6, docs/manual/praxis-ai.md and docs/manual/README.md before you change a screen. Read the other
   guides your prompt names.
3. Build your PR's checklist in handoff §6, top to bottom, against the sections it names. Contract
   first, then backend, then the screens against contract.gen.ts.
4. Keep to the files your PR owns (handoff §4, Files by PR). If you must touch another PR's file,
   say so in the PR description. When rebasing, never hand-merge contract.gen.ts: take either side
   and run npm run gen:contract.
5. The rules that bite most here: every list pages at 25 through shared/http/paged.js, the AI's
   reads and the pane included (decision 14); every write goes through the owning module's service,
   in a transaction, with emit(), and an action's run() is that service function, never SQL; the
   model proposes, the server decides: no permission is ever judged by a model (decision 16);
   follow-on work is an outbox handler; files through the one export path (decision 15); the engine
   folder requires nothing of MyCity (gate 24); every read, summary and action is in the committed
   catalogue snapshot (gate 23, npm run gen:ai-catalogue); snake_case contract keys equal to columns
   (gate 6); money as numeric strings; dates ISO on the wire, day first for people; screens only from
   @mycity/ui, tokens only, nothing the browser styles itself, one press one request (F26), the form
   system, a record in a sheet on a phone (F31), the three tiers of screen text and the word limits
   (guide §10 lists what reaches each screen; nothing else does); a native phone shell; search
   reaches every new screen and action; every AI call names its registered action, and this engine's
   is data-answers (decision 25). No donor names anywhere (scripts/check/provenance.js). Never a
   model id in commits, PR text or code.
6. Test as you go: unit tests beside the code, integration tests on the real migrations
   (RUN_DB_TESTS=1), every response parsed with its contract, the model scripted (never a real
   key in CI). Run npm run ci in full before you mark the PR ready.
7. Finish: tick your checklist items in handoff §6 with the date and add a §8 line; bring every
   guide section you changed up to what shipped and add a guide §14 line; in docs/PROGRESS.md tick
   what you completed, set Status and Updated, and add a note under Praxis AI (dd/mm/yyyy ·
   initials · done · left); list new files in README.MD; keep docs/DATABASE_SCHEMA.md true. Fill the
   PR template; for a screen change its Native app feel section says what you did on the phone and
   desktop shells, and the User Guide chapter and its pictures follow the screen (npm run
   guide:shots -- --stale). Mark the PR ready only when npm run ci is green; merge it yourself with
   Squash and merge once CI is green on GitHub (BACKEND_GUIDE §8.5), then update handoff §4 and §6
   with the merged PR's number. Your final message lists what changed, what is left and what you
   could not verify, and pastes the one-line prompt of the PR(s) that may start next.
```

```text
PR1 · ENGINE CORE · branch claude/engine-upgrade-guide-xf4ynp · migration 10330

Follow the COMMON RULES. You build the ground the other four PRs stand on; they start the moment
you merge, so completeness and exact shapes matter more than screens. Nothing a person sees changes
in this PR (User-guide-unchanged).

Also read: src/shared/ai/{manifest,registry,authorise,cite,catalogue-sync}.js,
src/services/ai/{llm.service,actions,redact,structured}.js, src/services/ai/assistant/*,
src/modules/assistant/*, src/modules/tasks/{tasks.ai,tasks.service}.js and its contract,
src/modules/security/security.service.js (assertFresh, confirm) and
src/modules/identity/identity.service.js (confirmedFor), src/middleware/idempotency.js,
scripts/check/{ai-no-writes,ai-actions,ai-manifest-coverage}.js, scripts/check/lib/changes.js,
tests/integration/assistant.test.js (how the model is scripted and people are made),
migrations/{0095_ai,10000_knowledge_ai_assistant,10310_assistant}.sql.

Build the "PR1" checklist of handoff §6.1:
- The contract (guide §5, §6.11 to §6.13): AiAsk gains context (AiScreenContext) and shows;
  AiAnswer gains card and context; AiReadMade gains n, module_key, params and outcome;
  AiAnswerDraft gains action and overview; AiActionCard, AiActionEdit, AiActionConfirm,
  AiActionResult, AiReadRows, AiSummaryResult, AiRisk; TABLES for gate 6.
- migrations/10330_praxis_engine.sql (guide §4): ai_message_read, ai_action_draft, ai_action_run,
  ai_catalogue.kind widened to summary and action with a risk column, ai_conversation.opened_from,
  ai_message.context. Triggers, indexes, ON DELETE, a DOWN that undoes exactly this.
- manifest v2 (guide §6.11, §6.13): defineManifest takes summaries and actions beside reads and
  routes, checks every key of an action and a summary at load, refuses SQL and write words still;
  the registry lists them and the catalogue carries kind summary and action with the risk; the
  snapshot src/shared/ai/catalogue.snapshot.json and scripts/gen/ai-catalogue.js (npm run
  gen:ai-catalogue); catalogue-sync writes the new kinds.
- authorise: allowedSummaries, runSummary (refuses rows), allowedActions, checkAction (grant, scope,
  values, records, bulk cap), the action's scope as requirePermission would give it.
- The engine boundary: src/services/ai/engine/{index,turn,cards,pane,content,matrix,errors}.js,
  pure, deps injected through createEngine(deps); the orchestrator and answer.js become the adapter;
  scripts/check/ai-engine-boundary.js (gate 24) in npm run ci.
- The card lifecycle (handoff §3.2) in src/modules/assistant/assistant.cards.js with its routes,
  the five-minute confirm for the sensitive risk classes, Idempotency-Key on confirm, one card per
  answer, 30 minutes, cancel, the events assistant.card_drafted, action_confirmed, action_failed,
  card_cancelled (audit only, no words).
- Read replay (handoff §3.3): GET /ai/answers/:id/reads/:n in assistant.reads.js, re-run with the
  stored parameters and the person's rights now, 25 a page.
- The orchestrator: context in the system turn; summaries as tools; actions listed with their
  fields; the draft's action validated into a card only when shows includes "cards", the overview
  kept only when it includes "pane"; the system turn in a fixed order and marked cacheable for
  Anthropic; prompt version 4.
- The reference action tasks.create in tasks.ai.js (standard risk, workspace create, input
  TaskCreate as New Task's form uses, run through tasks.service.create, readback the task's number
  and title), with the module's not_offered entries for its other Create schemas.
- Gate 19 rewritten (reads and declared actions only; no SQL in a manifest; run is a function) and
  gate 23 scripts/check/ai-awareness.js (handoff §7), both in npm run ci and in
  docs/BACKEND_GUIDE.md §8.4's table.
- The matrix: tests/integration/ai-matrix.test.js generated from the registry (every read, summary
  and action, every seeded role and the CEO: allowed exactly when scopeFor says so, refused
  otherwise, rows a subset of the CEO's and never carrying a masked field), with the staging seeds
  that give it rows; the attack scaffold tests/integration/ai-cards.test.js (a card drafted,
  confirmed, the task created; replayed, expired, forbidden after a grant is removed, over 25
  records, a sensitive class without a fresh confirm) with the model scripted.
- The documents: praxis-ai.md §1.1 (decisions 10 to 27), §4, §5, §6.11 to §6.15, §7, §9, §13,
  §14; MILESTONES §15's amendment line; CLAUDE.md step 4's AI line; BACKEND_GUIDE §2 and §8.4;
  BACKEND_STRUCTURE §14.3; DATABASE_SCHEMA M10; README map (gate names, new files); this handoff's
  §6 and §8.

Do not build the screens, the summaries of other modules, or any action beyond tasks.create.
```

```text
PR2 · FULL SCREEN AND THE PANE · branch m10/praxis-ai-pr2 (or the session's)

Follow the COMMON RULES. PR1 is merged: the API answers with context, reads (n, params, outcome),
a pane spec and (when a screen says it shows cards) a card; GET /ai/answers/:id/reads/:n pages a
read. You build what a person sees: the full-screen Praxis AI on both shells with its pane.

Also read: docs/FRONTEND_GUIDE.md §7 and §9 in full, docs/FRONTEND_FOUNDATION.md §3 (F6, F18,
F26, F28, F29, F31), docs/COMPONENTS.md (SplitPanes, Sheet, Tabs, DataView, KpiCard, the charts,
ItemChip, TapList, PhonePage, CommandPalette, FloatingButton), app/src/features/assistant/* as it
is today (keep what the guide's §10 keeps: the box, the microphone, Try Asking, Show Earlier,
Helpful and Not Helpful, the deleted-conversation cases), app/src/shell/{Search,Fab,screen-action,
layout-context}.tsx and app/src/lib/{router,trail}.ts (Back and steps), src/services/realtime/*
and app/src/api/realtime.ts (progress), docs/guides/user-guide.md and docs/manual/README.md.

Build the "PR2" checklist of handoff §6.2:
- The Assistant group in packages/ui (npm run new:component for each: header, test, gallery page):
  AssistantShell (the full-screen frame with Back and the pane), AnswerBubble (text with source
  chips), SourceChip, PaneTabs with OverviewPane (figures and the chart; empty state until PR3),
  TablePane (DataView on the read's rows, 25 a page through read replay, sortable where the read's
  schema allows, Download Excel disabled until PR3 wires it), RecordPane (the record behind a chip
  or a row with Open), SourcesPane (each read: name, filters, rows and total, when, outcome,
  masks), ProgressLine ("Reading leave requests", "Reading 2 of 5"), and the phone sheet that holds
  the four tabs. Tokens only; light and dark; Compact and Comfortable; 375 px.
- The way in (decision 12): the Praxis AI button on every screen (desktop top bar; the phone's
  floating button already has it), ⌘K and the menu item open praxis_ai.ask full screen; the
  opening screen's module, tab, record id and filters are kept as the conversation's context and
  sent with every question (AiAsk.context, shows: ["pane"]); Back (button, Escape, the browser's
  back, the phone's back) returns to that screen with its scroll and filters as they were (the
  router's steps, F29). A conversation opened from History or ⌘K has no Back target: Back goes to
  History.
- The layout: desktop, conversation about 40% and pane 60% (SplitPanes), Recent behind a toggle,
  the latest answer's pane shown and an earlier answer's chip bringing its pane back; phone, the
  conversation full width, Open Figures under an answer opening the pane sheet with its tabs. Empty
  tabs shown disabled.
- Progress (decision 23): the orchestrator's adapter emits ai:progress to the person's realtime
  room before each read (best effort, in assistant.service.js); the screen shows the line while
  the question runs and drops it when the answer lands.
- The mock for every new shape; the old Ask's tests moved onto the new screen; new tests for Back,
  the context sent, each pane tab, the phone sheet, progress.
- Guide §2 and §10 for the new screen (both tables), the User Guide chapter rewritten for it with
  its pictures retaken (desktop and phone), PROGRESS #67 ticked again with a note.

Do not build the card (PR4) or Overview's real figures and Excel (PR3): leave their slots in the
components, each stating the PR that fills it.
```

```text
PR3 · LARGE DATA AND EXCEL · branch m10/praxis-ai-pr3 (or the session's)

Follow the COMMON RULES. PR1 is merged: manifests may declare summaries (AiSummaryResult: figures,
groups, series, total), the engine keeps every read of a turn in ai_message_read, and
GET /ai/answers/:id/reads/:n replays a read. You make the big tables answerable and put the
whole list in Excel. You run beside PR2; touch only the files handoff §4 gives you, and add
Overview's drawing to packages/ui only after PR2 has merged (rebase then).

Also read: docs/guides/{attendance,workspace,ess,performance,foundation}.md §9 and §6 (the lists
and their scopes), src/modules/{attendance,tasks,leave,workflow,goals,kpis,reviews,organisation,
audit}/*.repo.js (the SQL each list runs), src/shared/http/paged.js, src/shared/documents/exports.js
and src/shared/spreadsheet/build.js, src/modules/settings/audit.export.js (the largest export today),
src/modules/assistant/assistant.export.js, src/services/ai/engine/pane.js.

Build the "PR3" checklist of handoff §6.3:
- Summary reads, declared in each module's manifest beside its reads with a listQuery-shaped
  params schema in its contract (no page): attendance (punches and exceptions by day, week, month,
  person, site; lateness counts and minutes), tasks (by status, assignee, due window, priority),
  leave (requests by status, type, month; days taken), approvals (waiting by stage and age),
  performance (key results by status, scores by function and month), employees (headcount by
  department, status, confirmation due), the Audit Log (entries by action and actor, by day).
  Each runs one SQL with the person's scope (scopeClause) on indexed columns, returns at most 20
  groups, 10 in a top list, 60 points in a series, and never a row; authorise.runSummary asserts
  it. A statement timeout of 3 seconds on every read and summary (SET LOCAL statement_timeout in
  the read's transaction); a timed-out read answers the model "narrow the question" and the
  screen says so.
- The summary cache: a summary with the same key, parameters and scope within 60 seconds is served
  from Redis (shared/... the one cache helper), never across people.
- Overview (decision 13): engine/pane.js builds figures and one chart from the summary the draft
  names; a title naming a value the summary does not hold is dropped; the prompt (version 5) says
  how to name a summary, figures and a chart; the contract's AiOverview filled.
- Download Excel (decision 15): POST /ai/answers/:id/reads/:n/export reserves an ai_answer_export
  document (export: true, personal) and emits assistant.read_export_requested; the outbox handler
  replays the read page by page as the person (their rights now, masks applied) up to 25,000 rows,
  writes the workbook with shared/spreadsheet (the rows' columns as the pane shows them), and a
  second sheet About This File (who, when, the question, the read and its filters, rows and total,
  the masks applied); the screen's Download Excel waits and downloads as every export does; "1,240
  rows: download Excel to see them all" past 200 rows.
- The evaluation set gains the summary questions (lateness this month by department, tasks overdue
  by person, leave days taken this year); the matrix covers summaries (PR1's generator does, once
  they exist); integration tests on the real migrations with seeded rows prove scope, the cap and
  the timeout.
- Guide §6.13, §5, §7, §11; DATABASE_SCHEMA; PROGRESS note; README map for the new files.
```

```text
PR4 · ACTION CARDS · branch m10/praxis-ai-pr4 (or the session's)

Follow the COMMON RULES. PR1 and PR2 are merged: the card lifecycle exists (draft, edit, confirm
with the five-minute Confirm It's You for sensitive classes, cancel), tasks.create is declared,
and the full-screen Praxis AI shows a pane. You declare the actions people will ask for and draw
the card.

Also read: docs/guides/{workspace,ess,community,mailbox,foundation,performance}.md (§3, §5, §6 and
§8 of each: who may do what, and the service function each screen's button calls),
src/modules/{tasks,calendar,leave,workflow,community,mailbox,goals}/*.service.js and their routes,
src/modules/security/security.service.js and app/src/auth/{FreshSignIn,passkey}.tsx (Confirm
It's You), src/shared/workflow/{engine,approvers}.js (nobody approves their own request),
tests/integration/ai-cards.test.js (PR1's scaffold), scripts/ai/eval-assistant.js.

Build the "PR4" checklist of handoff §6.4:
- Actions, each in its module's manifest, each an existing service function, each with its
  records(), check() and readback(): Workspace tasks.create (exists), tasks.complete (move to
  done), tasks.comment, calendar.create (an event with attendees); ESS my_leave.request; People
  leave.approve and leave.reject (risk approval; the approver's queue only; never one's own; bulk
  up to 25); Approvals approvals.decide (approve, reject, request changes on a request waiting on
  me; risk approval; decidedOnRecord refused with the screen offered); Staff Community
  community.message (a direct message to a colleague: openDirect then postMessage) and
  community.post (in a channel the person may post in); Mailbox mail.send (to, cc, subject, body;
  the person's connected mailbox, the draft saved then queued through mailbox.service.send with
  the signature it bakes; refused with the screen when no mailbox is connected); Performance
  goals.check_in where the service has one (else not_offered with the reason). Every other
  <Thing>Create schema of these modules is in not_offered with its reason (gate 23).
- Risk classes and the confirm sheet: standard one press; approval, money, payroll, delete through
  Confirm It's You, a passkey first when the person has one, else the PIN, else the password
  (FreshSignIn's form reordered for the card); Set Passkey offered once on the full screen to a
  person with none.
- The card on screen (packages/ui Assistant group: ActionCard, ResultLine): every field as the
  action will receive it, editable with the form system from the action's own contract schema, the
  records it touches named and linked, problems on their fields, the buttons (the verb with the
  count, Edit, Cancel), busy while it runs (F26), the result line per record, an expired card's
  Draw It Again; a suggested card reads as a question ("Tell Ada?") with Send and Not Now.
- Suggested cards (decision 20): the prompt (version 6) may offer one declared action after an
  answer when it plainly follows; never two cards; never run unasked.
- Mail and messages (decision 19): the drafted mail and message bodies come from the person's
  words and the records read, written as the mailbox's Write With AI writes (no placeholder,
  nothing invented); Praxis AI still reads no mail and no message.
- The evaluation set: an action case per action (the change asked for comes back as that card with
  the right values; a change the person may not make comes back as not available); the attack
  scaffold extended (self-approval, a record outside scope on a bulk card, a recipient outside the
  company, a mail with no mailbox connected); integration tests per module on the real migrations.
- Guide §2, §6.11, §8, §10 (the card on both shells), §11; the User Guide chapter (what to press on
  a card, the confirm sheet) with pictures; PROGRESS note; README map; each module's guide §9 gains
  its actions.
```

```text
PR5 · PROOF AND SWITCH-OVER · branch m10/praxis-ai-pr5 (or the session's)

Follow the COMMON RULES. PR1 to PR4 are merged. You prove the whole engine, make the awareness gate
universal, retire the old Ask and leave the documents describing exactly what ships.

Also read: tests/integration/{ai-matrix,ai-cards,ai-actions-*}.test.js, scripts/ai/eval-assistant.js,
scripts/check/ai-awareness.js, docs/guides/ai-control.md §2, §5, §6 and §10 (Spend),
src/modules/ai_governance/*, .github/workflows/ci.yml, docs/runbooks/*, docs/guides/user-guide.md.

Build the "PR5" checklist of handoff §6.5:
- Scope probes: each module with team or own scopes gives the matrix a probe in its manifest
  (matrix: { inside: (ctx) => a record the role sees, outside: (ctx) => one it does not }) built on
  the staging seeds; the matrix asserts a read returns the inside record and never the outside one,
  and an action refuses the outside one at check().
- The attack suite (decision 26) in tests/integration/ai-attacks.test.js with the model scripted:
  another person's pay, a record by guessed id, instructions planted in a message, a note and a
  policy, an action on a record outside scope, self-approval, a card replayed after rights were
  removed, a bulk card over 25, a mail to an outside address from a suggested card, a read named
  that was never offered; and scripts/ai/attack-assistant.js, the same questions asked of the real
  model on staging as a real person of each role, graded as eval-assistant.js grades, refusing
  production; .github/workflows/ai-nightly.yml runs it nightly against staging with the staging key
  and fails loudly on any leak.
- Leak monitoring on AI Control · Spend (ai-control.md §10): refusals this month (reads refused for
  want of a grant, cards refused at the press) and the nightly run's last result, as figures with
  help terms; a leak the nightly finds is an urgent notice to the Implementation Team.
- Gate 23's not_offered rule made universal: every module whose contract exports a <Thing>Create
  schema declares actions or not_offered; sweep every module and write the reasons.
- The old Ask retired (decision 27): one Praxis AI screen, History, the floating button's panel
  opening the same screen; dead components, mocks and tests removed; guide §2, §3 and §10 rewritten
  to what ships; the User Guide chapter final with every picture retaken; MILESTONES §15's line and
  README's assistant row brought to the engine; the extraction note (handoff §2 decision 17): what
  moves to JBS Praxis's own repository and what stays, in praxis-ai.md §13.
- PROGRESS: #67 and #68 Built with the date, the summary counts, a note.
```

---

## 6 · Progress

Tick with the date. A PR's row in §4 moves to its number when opened and "merged" when merged.

### 6.1 PR1 · Engine core (started 01/11/2026)

- [x] 01/11/2026 · The handover checked and the challenges resolved (§1, §2)
- [x] 01/11/2026 · The documents: this handoff; praxis-ai.md §1.1 decisions 10 to 27, §4, §5, §6.11 to §6.15, §7, §9, §13, §14; MILESTONES §15 amended; CLAUDE.md step 4; BACKEND_GUIDE §2 and §8.4; BACKEND_STRUCTURE §14.3; DATABASE_SCHEMA M10; README
- [x] 01/11/2026 · The contract: AiScreenContext, AiAsk.context and shows, AiAnswer.card, overview and context, AiReadMade's n, kind, module_key, params and outcome, AiAnswerDraft.action and overview, AiRisk, AiActionCard, AiActionEdit, AiActionConfirm, AiActionResult, AiReadParams, AiReadRows, AiSummaryResult, AiOverview; TABLES; gen:contract
- [x] 01/11/2026 · migrations/10330_praxis_engine.sql: ai_message_read, ai_action_draft, ai_action_run, ai_catalogue widened, opened_from, context; UP, DOWN, UP on Postgres (gate 4's live round trip in npm run ci)
- [x] 01/11/2026 · manifest v2: summaries and actions checked at load (label, bulk, risk, records, check, run, readback, labels, form, matrix probes, not_offered); the registry and the catalogue rows; catalogue-sync writes them
- [x] 01/11/2026 · The snapshot src/shared/ai/catalogue.snapshot.json and scripts/gen/ai-catalogue.js (npm run gen:ai-catalogue, --check)
- [x] 01/11/2026 · authorise: allowedSummaries, runSummary (refuses rows), allowedActions, checkAction (grant, scope, values, records, bulk)
- [x] 01/11/2026 · The engine boundary: services/ai/engine/{index, turn, cards, pane, content, matrix, errors}.js pure; gate 24 scripts/check/ai-engine-boundary.js
- [x] 01/11/2026 · The orchestrator and answer.js as the adapter: the screen context, summaries as tools, actions listed with their fields, the card drafted and checked, the overview kept, the system turn in a fixed order and marked cacheable for Anthropic; prompt version 4
- [x] 01/11/2026 · The card lifecycle: assistant.cards.js, its routes, the five-minute confirm (identity.provedAgo), Idempotency-Key on the press, one card per answer, 30 minutes, cancel, the four audit events; a refusal a person can fix returns on the fields with the card still open, a failure is recorded on the card
- [x] 01/11/2026 · Read replay: assistant.reads.js and GET /ai/answers/:id/reads/:n, 25 a page, the rights of the moment
- [x] 01/11/2026 · The reference action tasks.create in tasks.ai.js (TaskCreate as New Task's form, tasks.service.create, the task's number read back) and its not_offered entries
- [x] 01/11/2026 · Gate 19 rewritten (reads, summaries, declared actions and routes; no SQL or .query() in a manifest); gate 23 ai-awareness (the snapshot, the form's schema, a test and an evaluation case per action, not_offered, Try Asking's keys); both in ci-local.js and BACKEND_GUIDE §8.4
- [x] 01/11/2026 · The matrix test (every read, summary and action by every seeded role and the CEO on the staging seeds: offered exactly as scopeFor allows, refused when run, rows a subset of the CEO's, no masked field; own-only reads wait for PR5's probes) and the cards test (drawn, kept, nothing written; no card for a screen that draws none; edited, pressed, the task created, the run and the audit, a second press refused; a fixable refusal on the fields, a failing service recorded; expired, cancelled, over bulk, forbidden after the grant went; a sensitive class past the window refused and pressed once confirmed; a read run again)
- [x] 01/11/2026 · Unit tests: manifest v2, gate 19 on SQL, the turn loop, the card rules, the pane's Overview and Sources, the matrix generator, gate 24 (tests/unit/foundation/ai-engine.test.js, 26); the older suites brought to the new shapes
- [x] 01/11/2026 · npm run ci green under Node 20 (every gate, the whole suite: 2961 backend tests, 1123 and 644 frontend, 95 screens crawled); PROGRESS note; PR #49 opened as a draft, then ready; merged once CI was green on GitHub

### 6.2 PR2 · Full screen and the pane (started 01/11/2026)

- [x] 01/11/2026 · The Assistant group in packages/ui (AssistantShell, AnswerBubble with QuestionBubble, SourceChip, PaneTabs, OverviewPane, TablePane, RecordPane, SourcesPane, ProgressLine, PaneSheet; `pane.ts` their shapes), each with header, test and gallery page; the group in `scripts/gen/components.js` and the catalogue; tokens only, light and dark
- [x] 01/11/2026 · The way in: the Praxis AI button on every desktop screen's top bar, the floating button's chat on a phone, ⌘K and the menu; the opening screen travels as `from` on the address (`features/assistant/context.ts`): its module, tab, record, search and filters as `AiAsk.context` with `shows: ["pane"]` on every question; Back (the button, Escape, the browser's and the phone's Back) returns to that screen as it was (a step back when it is the step behind, else by its address); from the menu, ⌘K or History, Back goes to History
- [x] 01/11/2026 · The layout: desktop the conversation beside the pane (two fifths, three fifths) with Recent behind a toggle, the latest answer's pane shown and an earlier answer's chip or Open Figures bringing its own back; a phone opened from a screen the conversation full width with the pane as a sheet from Open Figures; a phone from the menu the conversations first, as before
- [x] 01/11/2026 · Table paging through `GET /ai/answers/:id/reads/:n` (25 a page, up to 200 rows, then "Showing the first 200 of 1,240 rows"; Download Excel's slot waits on PR3); Record from a row or the one record, with Open Record; Sources with each read's filters, rows and total, outcome and masks, Open Table; Overview draws figures and a chart when an answer carries them (PR3 produces them)
- [x] 01/11/2026 · Progress over realtime: `orchestrator.answer` takes `onRead`; `assistant.service` pushes `ai:progress` to the asker's room before each read with the question's `Idempotency-Key` (the controller hands it over); the screen shows Reading leave requests · 2 of 5 for that question alone and drops it when the answer lands
- [x] 01/11/2026 · The mock (the context echoed, the table's read, the reads' masks, a read run again with invented rows past the first page); the old Ask's tests moved onto the new screen; new tests for Back and Escape, the context sent, each pane tab, an earlier answer's pane, progress, the phone's sheet, the panel's context, the context helper, the orchestrator's hook and the service's push
- [x] 01/11/2026 · Guide §2, §3, §5, §6.1.8, §7, §10 and §14; the User Guide chapter rewritten with its pictures retaken; PROGRESS #67; FRONTEND_GUIDE §9.1's tree; this handoff

### 6.3 PR3 · Large data and Excel (started 01/11/2026, merged 01/11/2026 as praxisjbs/mycity-app#51)

- [x] 01/11/2026 · Summary reads: attendance, tasks, leave, approvals, performance (goals, and reviews), employees, the Audit Log (its `ai:none` dropped for a manifest with the summary alone); their query schemas in the contract; `shared/ai/summary.js` for the shape
- [x] 01/11/2026 · The statement timeout and the narrow-down answer (`authorise.guarded`: 3 seconds in the database, a 4 second deadline for a read on the pool; `AI_READ_TIMEOUT`, the model told "too much", the read kept as `timed_out`, migration 10340); the summary cache (`shared/ai/summary-cache.js`, Redis, 60 seconds, by person and scope)
- [x] 01/11/2026 · Overview: figures and the chart from the summary; the title checked against every value the summary holds; prompt version 5
- [x] 01/11/2026 · Download Excel through the export path with About This File (`POST /ai/answers/:id/reads/:n/export`, `ai_answer_export`, `assistant.read_export_requested`, the worker's replay with the person's rights now); the 25,000 cap; past 200 rows the pane says so (the words are PR2's TablePane, the rule in guide §6.13)
- [x] 01/11/2026 · The evaluation set's summary questions (six); `tests/unit/foundation/ai-summaries.test.js`; `tests/integration/ai-summaries.test.js` on the real migrations (scope, the caps, the cache, the timeout, Overview, the export and its cap); the matrix covers the summaries
- [x] 01/11/2026 · Guide §4, §5, §6.3, §6.13, §6.16, §7, §11, §14; the module guides' §9 (attendance, workspace, ess, performance, foundation, organogram); DATABASE_SCHEMA; PROGRESS; README
- [x] 01/11/2026 · After PR2 merged (#50): `main` merged in, the Table's Export wired on the full screen (`app/src/features/assistant/Pane.tsx` through `TablePane`'s `onExport`, the mock's route, a screen test), the User Guide chapter's pane step and its pictures retaken; OverviewPane already draws `AiOverview`, so nothing of PR3's is owed in `packages/ui`

### 6.4 PR4 · Action cards (started 01/11/2026, merged 01/11/2026 as praxisjbs/mycity-app#53)

- [x] 01/11/2026 · Actions declared: `tasks.complete` and `tasks.comment` (`TaskComplete`, `TaskCommentAdd`), `calendar.create`, `my_leave.request`, `leave.approve` and `leave.reject` (`LeaveApprove`, `LeaveReject`), `approvals.decide` (`ApprovalDecide`), `community.message` and `community.post` (`DirectMessageSend`, `ChannelPost`), `mail.send` (`MailCompose`, in a new `mailbox.ai.js` with no read); goals declares none, the check-in being a form of many lines, and says so. Each `records()` names its records through the module's own repo (`checkAction` hands it a database handle), each `check()` refuses a record the person may not see, each `run()` is the screen's own service function, a bulk one a line per record (`completeMany`, `leave.decideMany`, `workflow.decideMany`)
- [x] 01/11/2026 · `not_offered` for every other Create schema of those modules; gate 23 counts an input offered by any manifest (ESS offers leave's own request)
- [x] 01/11/2026 · The confirm sheet: `useFreshSignIn` starts on a passkey when the person has one, else the PIN, else the password, and tells its caller the way used; Set Passkey offered once on the device (a toast with the button) to a person who confirmed another way and has none
- [x] 01/11/2026 · `ActionCard` and `ResultLine` in the Assistant group (header, test, gallery page each); the card on both shells inside the answer (`app/src/features/assistant/Card.tsx`; the full screen and the phone's chat send `shows: ["cards", "pane"]`): the verb with the count (the decision's own word on an approvals card), Edit through the form system from the action's schema by its name with Save Changes, Cancel, busy with the buttons waiting (F26), problems on their fields and under the card with the screen that answers one (Open Mailbox), the result line per record with Open, Draw It Again on an expired card; the mock's card routes
- [x] 01/11/2026 · Suggested cards as a question with Not Now, never run unasked; prompt version 6
- [x] 01/11/2026 · Mail and message drafts held to ready to send as Write With AI is (`answer.gapsIn`, "Fill the gap", at the draft, an edit and the press); `AiCardField.long`
- [x] 01/11/2026 · The evaluation set's eleven action cases and `card.not-mine` (`no_action`); the attack scaffold in `ai-cards.test.js` (one's own request, a grant never reached, a stranger as recipient, a mail without a mailbox); `ai-actions-{workspace,leave,approvals,community,mailbox}.test.js` on the real migrations (four leave requests approved with a passkey, two rejected with a PIN, self-approval and a request outside scope refused, Tell Ada, a mail queued with the signature baked); `tests/integration/helpers/ai-actions.js`
- [x] 01/11/2026 · Guide §2, §5, §6.11, §8, §10, §11, §14; each module's guide §9 (workspace, ess, community, mailbox, foundation, performance) and `identity.md`; the User Guide chapter's card section with its picture; PROGRESS; README; FRONTEND_GUIDE §9.1

### 6.5 PR5 · Proof and switch-over (started 01/11/2026, praxisjbs/mycity-app#56)

- [x] 01/11/2026 · Scope probes in the matrix: `matrix: { inside, outside }` on the scoped reads and actions of Workspace (`tasks.list`, `tasks.complete`, `tasks.comment`, `calendar.month`), People (`employees.list`, `leave.requests`, `leave.approve`, `leave.reject`, `attendance.register`), Home (`team.today`, `activity.list`), ESS (`my_profile.get`, `my_leave.list`), approvals (`approvals.mine`, `approvals.decide`) and Staff Community (`channels.list`, `community.post`, `community.message`), each built through the module's own service from the `ctx` the suite hands it; the matrix gives each role a report and itself an outsider, walks a list's pages, and asserts every probe (`praxis-ai.md` §6.17). Performance and Queries carry none, and say why
- [x] 01/11/2026 · The attack suite: `scripts/ai/attack-assistant.js` (eleven attacks, the grades, the run recorded through `recordAttackRun`, production refused), `tests/integration/ai-attacks.test.js` (each attack with the model scripted, every refusal counted, a run recorded and its leak told), `tests/unit/foundation/ai-attacks.test.js`; `deploy-gate attack` (the staging key's third command, no deploy lock, the release's own code) with its refusals in `deploy.test.js`; `.github/workflows/ai-nightly.yml` at 02:17 Lagos, failing loudly on a leak and warning on a run that could not run; releases now carry `scripts/ai`
- [x] 01/11/2026 · Refusals and the nightly result on AI Control · Spend: `AiSpend.praxis_ai` (`AiPraxisSpend`, `AiAttackRun`), migration `10350` `ai_attack_run`, `assistant.action_refused` recorded at a press refused for want of rights, Reads Refused, Presses Refused and Nightly Attacks as KpiCards with help terms on both shells; `ai_control.attack_leaked` the one notice AI Control sends (urgent, `ai_control` edit, Acknowledge, opens Spend)
- [x] 01/11/2026 · Gate 23's not_offered rule universal: every module whose contract exports a `<Thing>Create` schema offers it, lists it in `not_offered` with a reason or opted out whole with one; thirteen manifests gained their reasons; `--list` prints the sweep
- [x] 01/11/2026 · The old Ask retired (decision 27): the floating button's Praxis AI opens the one full-screen Praxis AI with the screen underneath as `from`; `AskPanel.tsx` and its test removed, `ChatPage` carries no context; guide §2, §3 step 8, §10 and the User Guide chapter follow
- [x] 01/11/2026 · Guide §6.17, §4, §7, §13 (what an extraction moves and what stays), §14; `ai-control.md` §2, §4, §5, §7, §10, §14; `policies.md` (the `policies.read` fix the suite found); the User Guide chapters for Praxis AI and AI Control with their pictures; MILESTONES §15; README; DATABASE_SCHEMA; the runbooks (`deploy.md`, `monitoring.md`) and SYSTEM_ARCHITECTURE §9.5 for `attack`; PROGRESS

---

### 6.6 After PR5 · Seamless tasks and meetings (decisions 28 to 31; started 01/11/2026, branch `claude/determined-dirac-b4ivrd`, praxisjbs/mycity-app#57, merged 02/11/2026)

- [x] 01/11/2026 · The decisions in `praxis-ai.md` §1.3 and here (§2), `workspace.md` §6's watcher rule
- [x] 01/11/2026 · The contract: `TaskCreate.watcher_ids` and `watcher_department_id`; `AiAnswerDraft.ask`, `AiAnswer.choices`; `AiCardField.picks`, `AiActionCard.names`; gen:contract
- [x] 01/11/2026 · Tasks: watchers at creation (people or a department's active people, at most 25), told they are watching; a watcher sees the panel and the comments and finds the task in ⌘K, never on their board, and cannot work it (`readable` beside `visible`); Add Watcher takes any colleague; notices reach every watcher with a login
- [x] 01/11/2026 · The engine: manifests take `fields`, `picks`, `names` and `asks`; `checkAction` names; migration `10360` (`ai_action_draft.names`); the server's must-ask guard (`answer.askFirst`), the asks kept on the answer (`metadata.ask`) and replayed; prompt version 7; `colleagues.list` (Staff Community's directory) so anyone can be named
- [x] 01/11/2026 · `tasks.create` and `calendar.create`: their fields, pickers, names and asks; records only what a press acts on (the event's attendees are named, not counted)
- [x] 01/11/2026 · The screens: choices under an answer (`AnswerBubble` `choices`), a tap asked as the next question; `ActionCard` Edit with the app's pickers and names; New Task's Watchers and Watching Department; the panel read only for a watcher; the mock
- [x] 01/11/2026 · Tests: unit (manifest, cards, the guard, the system turn), integration on the real migrations (names, watchers, the guard's run of questions with the model scripted), screens; the evaluation set's follow-up cases; the catalogue snapshot
- [x] 01/11/2026 · Documents: `praxis-ai.md` (§2, §4, §5, §6, §10, §11, §14), `workspace.md` (§3, §5, §6, §7, §9, §10, §11, §14), `community.md` §9, the User Guide chapters (Praxis AI, My Workspace) with their pictures, PROGRESS, README, DATABASE_SCHEMA
- [x] 02/11/2026 · `npm run ci` green, run group by group in a cloud session (a command there stops at 10 minutes): checks, frontend (the app's tests in three shards), screens (each gate on its own) and backend (Jest in six shards, the database on); two tests that failed on main too, by the date, fixed in their own commit; merged as praxisjbs/mycity-app#57 (`c7195d8`, squashed) once every CI job was green on GitHub, at the first run

### 6.7 After staging · Answers that read well (JBS Praxis, 02/11/2026; branch `claude/determined-dirac-b4ivrd-answers`)

From JBS Praxis's questions on staging: a register tabled with no names ("What are the names?"),
statuses as codes (`not_in`), "nobody is absent" while 21 had not clocked in, a question with no
answers to tap, Open Figures under every answer and an empty pane on a reopened conversation.

- [x] 02/11/2026 · `praxis-ai.md` first: §6.2 (words, never codes; absent in the person's sense), §6.4 (a table names its records; codes as words; an ask's choices from the action's `asks`), §6.12, §10.1 and §10.2 (Open Figures, a question's words alone, the latest answer's pane on opening), §11, §14
- [x] 02/11/2026 · The answer: `drawTable` reaches into a row and names its records (`whoOf`), a record reads as its name, a list as one cell, an id never; `defaultFields` leads with who; `withChoices` fills a question's answers from the action's `asks`; prompt version 8; the register read says what Not In and Absent mean
- [x] 02/11/2026 · The screens: Open Figures only under an answer with a table or figures, a question without From, and `onLatest` with `usePane().showFirst` so a conversation opened from Recent or History shows its latest answer's pane
- [x] 02/11/2026 · Tests: unit (`ai-assistant.test.js`, `ai-eval.test.js`), integration (the register through the engine and its replay, `ai-cards.test.js`), screens (`Assistant.test.tsx`); the evaluation set's `attendance.absent` and `ask.task-priority`
- [x] 02/11/2026 · Documents: the User Guide's Praxis AI chapter, PROGRESS #67, this file
- [x] 03/11/2026 · Run the evaluation set on staging with the real model: first run by TB on the server; what it found and the rerun are in §6.9

### 6.8 After staging · A card never shows an id (decision 32, JBS Praxis, 03/11/2026; branch `claude/determined-dirac-b4ivrd-ids`)

From JBS Praxis's question on staging, "Leave type shows UUID. I noticed that too on assigning a
task. Is that deliberate?" It was not: Request Leave had no names or picker, and a card printed any
id nothing named.

- [x] 03/11/2026 · `praxis-ai.md` first: §1.4 decision 32, §6.11 (`resolve`, `options`, Pick one, the actions table), §10.1, §11, §14; `ess.md` §9 and §14
- [x] 03/11/2026 · The contract: `AiCardPicks` gains `leave_type`; gen:contract
- [x] 03/11/2026 · The engine: manifests take `resolve` and asks take `options`; `authorise.checkAction` resolves names first and marks a picked id nothing names Pick one (at the draft, Save Changes and the press); `answer.withOptions`; the system turn says "(its name)" and "by name"; prompt version 9
- [x] 03/11/2026 · `my_leave.request`: fields, the `leave_type` pick, names, "Which leave type?" with the person's types and days left, a type matched by name
- [x] 03/11/2026 · The screens: `ActionCard` never prints an id and Edit holds Save only on a field it can change; the card's Leave Type picker is `LeaveTypeSelect`, Request Leave's own
- [x] 03/11/2026 · Tests: unit, integration (leave by name, a made-up id refused, the type asked; a task card's unknown person), screens; `ask.leave-type` in the evaluation set; the leave cards' test days are working days, a holiday week skipped (it failed on 03/11/2026: Boxing Day observed on Monday 28/12)
- [x] 03/11/2026 · Finished after staging: a type written "Annual Leave" matches the type named Annual (with or without the word Leave, a name either side begins); a card with a problem keeps what was matched; an id field reads only as a name the card knows; the pane follows the latest answer that read records or has figures, never blank after a card
- [x] 03/11/2026 · Run the evaluation set on staging with the real model: first run by TB on the server; what it found and the rerun are in §6.9

### 6.9 Every form in the chat: the gate (decision 33, JBS Praxis, 03/11/2026; branch `claude/determined-dirac-b4ivrd-forms-gate`)

Asked for on 02/11/2026 after the list of the hub's forms showed five of about 76 create and edit
forms reachable from the chat; the gate's shape was approved on 03/11/2026 ("go ahead with the forms
gate"). This PR adds the gate and the list; the forms themselves follow, module by module.

- [x] 03/11/2026 · `praxis-ai.md` first: §1.5 decision 33, §6.15 rule 6, §14
- [x] 03/11/2026 · Gate 23 rule 6 (`scripts/check/ai-awareness.js`, `formsAccountedFor`): each create and edit schema of a built module is an action, `via <action>:`, a never word (`secret`, `device`, `personal`, `file`, `ai`) or on `scripts/check/ai-forms-gaps.json`, which only shrinks; `not_offered` may name an edit schema; `--list` prints every form and how it is accounted for
- [x] 03/11/2026 · The never and via reasons: a punch and a check-in `device`, a home location and `EssProfileUpdate` `personal`, an import and the documents module `file`, the integrations module and `SecurityPolicyPatch` `secret`, the assistant module (a card's own edit) `ai`; `MessageCreate` and `DirectCreate` via `community.message`, `TaskCommentCreate` via `tasks.comment`, `MailDraftSave` via `mail.send`
- [x] 03/11/2026 · Today's gaps: 89 forms listed, each with where it lives (3 in the chat, 4 through another action, 20 never, of 116)
- [x] 03/11/2026 · Tests: the rule's cases (a new form, a gap added, a gap closed or stale, a via naming no action) and the list's shape (`ai-engine.test.js`)
- [x] 03/11/2026 · Workspace and Calendar (branch `claude/determined-dirac-b4ivrd-workspace-chat`): ten cards, Save Task, Add Step, Save Step, Add Link, Add Reason, Switch Reason, Create Project, Save Project, Save Event, Save Support Needed; an edit form's card names its record (`<Thing>Change`, `TaskStepAdd`, `TaskWaitOn`, `LateReasonSwitch`) and the form's own schema is reached `via` it; actions may name a `capability`; `resolve` is handed the card's values; the `task` pick; `tasks.get`; ten gaps closed (79 left)
- [x] 03/11/2026 · Home and Settings (branch `claude/determined-dirac-b4ivrd-home-settings`): eighteen cards; decision 35 (`design`) for a role's grants, an approval flow and its steps, a role's Home cards; the push subscription `device`; `shared/ai/change.js`; `view` with a capability; 22 gaps closed (57 left)
- [x] 03/11/2026 · People, Queries & Sanctions and Knowledge Hub · Policies (branch `claude/trusting-cerf-30yc7i`): 25 cards through the screens' own functions; decisions 36 to 39 asked first (`praxis-ai.md` §1.8: the work record alone, a place picked on a card, the saved signature signs, approval for pay, leave and discipline); the `place`, `employee`, `worksite`, `policy` and `site_member` picks; a picked field reads as an id; `allows` for a letter's {{ names }}; Draw Signature; `query_rules.ai.js`, `templates.ai.js`; Save Letter Signature never (`file:`); 26 gaps closed (31 left after #69). Engine files changed additively only: the picks appended (`AiCardPicks`, manifest `PICKS`, `ActionCard`'s type, `Card.tsx`'s cases and `SCREEN_FOR`), the manifest's `allows` key, `fieldsOf`'s picked field and `gapsIn`'s second argument (callers pass the action)
- [x] 03/11/2026 · Performance, Staff Community and Mailbox, decided (branch `claude/ecstatic-cori-rplleb`): the four questions put to the owner and their answers (§2 decision 40); `praxis-ai.md` first (§1.9, §6.11's 32 rows, §6.17, §8, §14), then `performance.md`, `community.md` and `mailbox.md` §9 and §14
- [x] 03/11/2026 · Performance, Staff Community and Mailbox, built: the contract's card schemas; an action's `capabilities`, any one of a list (`requireAnyCapability`), beside `capability`; 32 actions through the screens' own services, a record named by its words (`oneNamedIn`), a form of many lines carried a line at a time; gate 23 reads a typed `useContractForm<Values>(` call; the gaps list 31 shorter (none left after Home and Settings and People, Queries and Policies); the integration suites (`ai-actions-performance`, `-community`, `-mailbox`), 34 evaluation cases, five matrix probes, the catalogue (32 added), the User Guide's five new tasks, PROGRESS, README
- [x] 03/11/2026 · Performance, Staff Community and Mailbox, praxisjbs/mycity-app#68, rebased on decisions 34 to 39 (praxisjbs/mycity-app#67, praxisjbs/mycity-app#69 and praxisjbs/mycity-app#70; renumbered 40, `praxis-ai.md` §1.9): every one of the 32 asks what it needs first, gate 23 rule 7 green; two question tests (`ai-actions-performance`, `-community`), two evaluation question cases, `named.choiceWords`
- [x] 03/11/2026 · Every built module's create and edit forms accounted for: the gaps list is empty, praxisjbs/mycity-app#68 the last of the four chats
- [x] 03/11/2026 · The evaluation set on staging (TB ran `--only=card` and `--only=ask` from `/srv/mycity/stg/current` as `mycity-stg`, branch `claude/ecstatic-cori-rplleb`): three bugs fixed (an offered action called as a read answered "not available"; Create Task "for me" left as Pick one and its names failing on words; a figure such as "95%" refused), and the set asks as the role holder with the most open tasks about their own records, skipping what staging lacks (`praxis-ai.md` §6.10)
- [ ] Rerun the evaluation set on staging after this change (`sudo -u mycity-stg /usr/bin/node --env-file=/srv/mycity/stg/shared/.env scripts/ai/eval-assistant.js --only=card`, then `--only=ask`), and act on what still fails

### 6.10 A card is drawn whole (decision 34, JBS Praxis, 03/11/2026; branch `claude/determined-dirac-b4ivrd-ask-first`)

Asked for on 03/11/2026 after a Create Task card shared with a department reached the press with no
lead ("It should always ask for required fields, so we never see an error. We can add a gate for that.").

- [x] 03/11/2026 · `praxis-ai.md` first: §1.6 decision 34, §6.11 (`when`, `read`, `options` with the values), §6.15 rule 7, §14
- [x] 03/11/2026 · Engine: asks take `when` (a field, or `{ field, not }`) and `read` (with `params`, `type`), checked at load and, for the read, once every manifest is loaded (`registry.checkAskReads`); `nextAsk` honours `when`; `askFirst` fills the screen's record first; `withOptions` answers a record question from its read with the person's rights and keeps the model's own answers; `authorise.resolved` matches a record by its words, a list one by one; the system turn says which fields are records and which are asked only sometimes
- [x] 03/11/2026 · Gate 23 rule 7 (`requiredAsked`): every required field of every action's input has an ask
- [x] 03/11/2026 · Questions on every action (18 lacked one); the lead of a task shared with a department; tests; two evaluation cases

### 6.11 Documents in the chat (decisions 41 to 48, TB, 13/11/2026; `praxis-ai.md` Appendix A)

PR 1, the attach control with invoices and payment receipts, built on the branch
`claude/praxis-ai-docs-pr-1-2akyek`, praxisjbs/mycity-app#144, merged 13/11/2026. PR 2 (contracts and MoUs) built on
`claude/pensive-darwin-sa4pn0` the same day, in its own chat, once PR 1 had merged: praxisjbs/mycity-app#146.

- [x] 13/11/2026 · `praxis-ai.md` §6.18 rewritten as built first (the overlay before the ask guard and on later questions, `from_file`, gate 23 rule 8, the file named on its field, a receipt matching none asks which request, migration 8030), §2, §5, §6.15, §10, §11, §14; `expenses.md` §4, §5, §6.1, §9, §10, §14; `foundation.md` §14
- [x] 13/11/2026 · Contract: `AiAttachmentKind`, `AiAttachment`, `AiAsk.attachment` (an empty question with a document), `AiAttachmentKinds`, `AiAnswer.attachment`, the card field kind `lines`; `ExpenseInvoiceRead` and `ExpenseInvoiceSuggestion` widened, `ExpenseRequestFromInvoice`; `DisbursementReceiptRead`; the upload purpose `ai_attachment`
- [x] 13/11/2026 · Engine: the manifest's `files` (`defineManifest`, `registry.files`, `file`, `filesFor`, the kinds' cards checked after load), an action's `from_file`, `cards.kindOf` `lines` and a line's numbers shaped; the orchestrator's read 1 (`file.<kind>`, four reads left), the reading replayed in later turns, the file's actions offered only with it; `answer.withReading`, `readingChoices`, `readingProblems`; gate 19's header, gate 23 rules 7 and 8
- [x] 13/11/2026 · Assistant: `assistant.files.js` (the kinds, the one reading of the person's own staged upload, what an answer keeps), `GET /ai/attachment-kinds`, the ask's reading step, an unreadable file answered in one sentence with no model asked, the server's sentences; History and the replay carry the attachment
- [x] 13/11/2026 · Expenses: Read Invoice widened for the chat (`readForChat`: the lines with paid to date, Check the lines, Naira only, paid in full, the payee's bank, the payee type, a possible duplicate), `my_expenses.from_invoice`, a negative line and `EXPENSE_TOTAL_NOT_POSITIVE`, migration `8030_expense_line_discount.sql`; Disbursements: `disbursement-receipt-read` (Image Reading, chosen by TB) and its prompt, the request match in SQL (`requestsPaidBy`), Record Disbursement carrying the receipt
- [x] 13/11/2026 · Screens: Attach Document (`app/src/features/assistant/Attach.tsx`) on desktop and in the phone's chat, the file chip on the question's bubble, `LinesField`, `MoneyField` `signed`, `RadioCards` captions, the card's `lines`, New Request's form on `LinesField` with the bank from Read Invoice; the in-browser mock in contract shapes
- [x] 13/11/2026 · Tests: `tests/integration/ai-files.test.js` (the four cases of Appendix A and an unreadable file, a paid-up invoice, a Word file), `expenses.test.js` (a discount line, a total below zero), `expenses-ai.test.js` (the bank), the components' and `Assistant.test.tsx`'s; two evaluation cases with made-up samples under `scripts/ai/samples/`
- [x] 13/11/2026 · The User Guide: Praxis AI's Attach a document with its picture, Expenses' Raise a request, its pictures retaken; PROGRESS (#67, #56, #59), README
- [ ] On staging: the sample invoice into a request of ₦150,000.00 its line manager opens with its invoice, and a receipt recorded from the chat (`eval-assistant.js --only=file`)
- [x] 13/11/2026 · PR 2 · `praxis-ai.md` §6.18's Contract or MoU rewritten as built first (a kind's grant may be `view`, the card's kind by name with `PartnerDocumentAdd` kept, `PartnerDocumentAttach` in no `not_offered`, the reading's `currency` and each signatory's party, the pane never a Table of a file read), §2, §6.11, §8, §10, §11, Appendix A, §14; `partnerships.md` §9, §14; `ai-control.md` §13, §14; `user-guide.md` §14
- [x] 13/11/2026 · PR 2 · Contract: `AgreementDocumentRead` (and its parts) and `AgreementSignedCopyAdd` (agreements.js), `PartnerDocumentAdd` (partners.js), `AiAttachmentRecord` on `AiAnswerAttachment.record` (assistant.js)
- [x] 13/11/2026 · PR 2 · Backend: `agreement-document-read` on Image Reading (chosen by TB) and its prompt; `agreements.document-ai.js` (the terms, the parties matched among the records the person may edit, MyCity set aside, the agreement waiting for its signature); the kind `contract` in Agreements' manifest for Partnerships view (`FILE_GRANTS`); `agreements.record_signed_copy` (risk approval) and `partner_documents.attach` (its kind by name), each through the route's own service; `assistant.files` and the service carry the terms; the chat's prompt version 11; the staging setup's document kinds
- [x] 13/11/2026 · PR 2 · Screens: the pane opens a contract's terms on Record (first, from its file's From chip, from Open Figures on a phone) and never offers a Table of a `file.<kind>` read; the in-browser mock's Contract or MoU
- [x] 13/11/2026 · PR 2 · Tests: `tests/integration/ai-contracts.test.js` (a signed MoU sealed on its agreement in Sent after Confirm It's You, the lead converted; an MoU filed on its partner, kind MOU; a party nobody may edit asks whose; view alone, no card), `ai-files.test.js` and `ai-control.test.js` and the staging seed's test updated, `tests/unit/foundation/ai-contracts.test.js`, `Assistant.test.tsx`, the User Guide parser's; two evaluation cases with made-up MoUs (`scripts/ai/samples/mou.pdf`, `mou-signed.pdf`)
- [x] 13/11/2026 · PR 2 · The User Guide: Praxis AI's Attach a document with a contract's picture (`praxis-attach-contract`, taken with the new `upload:` step) and `praxis-attach` retaken with its third tile; Partnerships' two tips; PROGRESS (#67, #54), README
- [ ] On staging: a contract read with the real model (`eval-assistant.js --only=file.contract`); send Lagoon Youth Fest's agreement for signature there to run `file.contract-signed`

### 6.12 Charts in the Overview (decisions 49 to 58, JBS Praxis, 13/11/2026; `praxis-ai.md` Appendix B)

Planned in one chat; each PR is built in a fresh chat from its start prompt (Appendix B.5), opened
ready for review with GitHub's CI green, then reviewed and merged from the planning chat. Merge
order: PR 1 first, PR 3 after PR 2, PR 8 after PRs 4 to 7 (Appendix B.2). Tick an item with the
date, the branch and the PR when it merges.

- [x] 13/11/2026 · PR 1 · Stacked bars, Budgets' summary and every read naming its summary, gate 23 rule 9 with `scripts/check/ai-summary-gaps.json`, money in naira, no mechanics in an answer (built in the planning chat on `claude/bold-hawking-byligf`)
- [ ] PR 2 · Charts from a complete table (`m10/overview-tables`)
- [ ] PR 3 · A charted answer's table in the pane, the Overview's View Data and Download PDF, `shared/documents/chart.js` (`m10/overview-pdf`)
- [x] 13/11/2026 · PR 4 · Finance and pay summaries: `expenses.summary`, `requisitions.summary`, `disbursements.summary`, `payroll.month` by department and status, `payroll.trend`, `deductions.summary`, `my_pay.summary`; ten reads off the gaps file (built in its own chat on `claude/serene-shannon-ek7yft`)
- [ ] PR 5 · Recruitment and onboarding summaries (`m10/summaries-recruitment`)
- [ ] PR 6 · Partnerships summaries (`m10/summaries-partnerships`)
- [ ] PR 7 · People, performance and queries summaries (`m10/summaries-people`)
- [ ] PR 8 · Workspace, Knowledge Hub, Community, Home and Settings summaries; the gaps file deleted (`m10/summaries-close`)
- [ ] On staging: the budget question by department draws stacked bars, and its Download PDF opens on the letterhead

## 7 · Gates this work adds

| Gate | Script | Refuses |
|---|---|---|
| 19 (rewritten) · AI manifests: reads and declared actions only | `scripts/check/ai-no-writes.js` | A manifest key that is a write by another name (`write`, `writes`, `executor`, `execute`, `mutations`, `sql`, `query`); an `.ai.js` that holds SQL or calls `.query(`; an action whose `run` or `check` is not a function; a manifest that does not load through `defineManifest` |
| 23 · AI awareness | `scripts/check/ai-awareness.js` | (1) `src/shared/ai/catalogue.snapshot.json` differs from `registry.catalogue()` (keys, kinds, modules, permissions, risk, the hash of each parameter, input and prefill schema): run `npm run gen:ai-catalogue` and review the diff. (2) An action's `input` is not a schema the module's own feature folder validates a form with (`useContractForm(..., <schema>)`), unless the action says `form: "none: <reason>"`. (3) An action key that no integration test exercises, or that the evaluation set (`scripts/ai/eval-assistant.js`) does not grade. (4) A module that declares `actions` and leaves a `<Thing>Create` schema of its contract neither offered nor in `not_offered` with a reason (PR5 makes this rule universal). (5) A Try Asking line (`assistant.suggestions.js`) naming a read that does not exist. Planned in `praxis-ai.md` Appendix B PR 1: (9) a read with no `summary` that is not in `scripts/check/ai-summary-gaps.json`, a `summary` naming no summary, and a gap that is now answered or that the change's base did not hold |
| 24 · AI engine boundary | `scripts/check/ai-engine-boundary.js` | A file under `src/services/ai/engine/` that requires anything but Node's builtins and its sibling files; a file outside it that reaches into the engine's internals rather than its `index.js` |
| The matrix | `tests/integration/ai-matrix.test.js` | Any read, summary or action a role may run that `scopeFor` would refuse, or the reverse; a scoped person's rows that the CEO's do not contain; a masked field reaching a person without the field grant; a probe's outside record returned or acted on (PR5) |
| The attack suite | `tests/integration/ai-cards.test.js` (PR1), `ai-attacks.test.js` (PR5), nightly `scripts/ai/attack-assistant.js` through `deploy-gate attack` and `.github/workflows/ai-nightly.yml` (PR5) | A card run twice, expired, after a grant was removed, over 25 records, or sensitive without a fresh confirm; and from PR5 every attack of §5's PR5 prompt: another person's pay, a guessed id, instructions planted in a message, a note and a policy, an action outside scope, self-approval, a card after the grant went, a bulk card over 25, a mail outside from a suggested card, a read never offered. With the real model a leak fails the nightly and is an urgent notice; AI Control · Spend shows the last run |

---

## 8 · Log

- 13/11/2026 · JP · Charts in the Overview, PR 4 built (§6.12): the seven finance and pay summaries of
  `praxis-ai.md` §6.13, each one SQL in its module's repo with the reader's scope or the list's own audience
  (`expenses.summary`'s `mine` and `waiting_on_me` as `expenses.mine` and `expenses.approvals` read), pay left
  out for a reader whose role hides it and a person's own never hidden from them; ten reads name their
  summary and leave `scripts/check/ai-summary-gaps.json` (38 left); `tests/integration/ai-summaries-finance.test.js`
  and eight evaluation cases. Found on the way, written into §6.13: `payroll.month` gave its money as `NGN`,
  which the Overview does not read as naira (it reads `ngn`), so it is `ngn` now; a summary carries no
  capability of its own, so requisitions' and disbursements' answer a reader without `expenses.finance` with
  no figures, as their reads answer an empty page; the model writes a yes-or-no filter as a JSON boolean, so
  the summaries take `true` and `false` where the lists take the query string's words; `waiting_on_me` counts
  what waits now whenever it was sent unless a period is asked. Staff now see `expenses.summary`,
  `requisitions.summary`, `disbursements.summary` and `my_pay.summary` offered, so `ai-summaries.test.js`'s
  list of the summaries offered to staff gains them. The container's PostgreSQL lacked pgvector again
  (installed by hand, `postgresql-16-pgvector`), and the image had no Node 20 under `/opt` (installed into a
  scratch folder).
- 13/11/2026 · JP · Charts in the Overview, PR 1 built (§6.12): `AiSummaryPart` and a group row's
  `parts`, `engine/pane.js` drawing them as one series a part, `budgets.summary`, a read's `summary`
  in the manifest, the snapshot and the description the model is offered, gate 23 rule 9 with its
  gaps file, `MONEY_FIELD` widened, the prompt at version 11, the evaluation set's `chart` and
  `never_words`. Found on the way: staff hold `expenses` view, so `ai-summaries.test.js`'s list of
  the summaries offered to staff gains `budgets.summary` (over no budgets).
- 13/11/2026 · JP · Charts in the Overview planned: `praxis-ai.md` §1.11 (decisions 49 to 58),
  §6.13's planned tables, §6.19 and Appendix B (eight PRs, each in a fresh chat; §6.12 here). The
  engine side: a summary group row's `parts` drawn as a stacked bar (`engine/pane.js`), an
  Overview from a whole list's rows (`overviewOfRows`), each read's `summary` in the manifest and
  the catalogue, gate 23 rule 9, and a chart in a document (`shared/documents/chart.js`).
- 13/11/2026 · TB · Documents in the chat, PR 2 built (§6.11): Contract or MoU read, summarised with its terms on
  the pane's Record tab, and filed by Record Signed Copy on the agreement waiting for its signature or by Add
  Partner Document on its partner or lead. Found on the way and written into `praxis-ai.md` §6.18: the
  manifest refused a `view` grant on a file kind, which decision 41 asks for, so files take any grant
  (`FILE_GRANTS`); gate 23 refuses a `not_offered` naming a schema that is no create or edit form, so
  `PartnerDocumentAttach` is in none; a file read is never replayed, yet the pane opened it as a Table and
  asked for its replay (404 for every invoice and receipt answer), so it opens Record or Sources; the
  in-browser mock's upload is beaten by a press at once, so the picture tool's new `upload:` step pauses as a
  person does; staging had no document kinds. The container's PostgreSQL lacked pgvector again (installed by
  hand, `postgresql-16-pgvector`).

- 13/11/2026 · TB · Documents in the chat, PR 1 built (§6.11): Attach Document with Invoice and
  Payment Receipt; the reading as read 1 and its values over the model's card before the ask guard,
  kept on the answer so a later question keeps the file's figures; New Request from an invoice for
  its balance due, Record Disbursement from a receipt with the request matched in SQL. Found on the
  way and written into `praxis-ai.md` §6.18: the registry already used `file` on every entry, so an
  action drawn from a file says `from_file`; a document's citation needs `link: null` for the
  answer's contract; a receipt's beneficiary account is kept under `account_number` so redaction
  keeps it from the chat's model; 8010's CHECKs refused a negative line, so migration 8030.
- 13/11/2026 · TB · Documents in the chat planned: `praxis-ai.md` §1.10 (decisions 41 to 48),
  §6.18 and Appendix A (two PRs, each in a fresh chat). The engine side PR 1 builds: the manifest's
  `files` key, the ask's reading step as one read, and `draftCard` laying the reader's fields over
  the model's values.
- 13/11/2026 · TB · The engine gains `cards.shape` (a value in the form its field's JSON Schema
  takes: the model's 700000 is "700000.00", 1 is "1"), run by `authorise.checkAction` on every card;
  `kindOf` draws figures sent as text as `number`. The manifest gains an ask's `also` (one turn, one
  short question a field) and an action's `then` (next steps under a done press,
  `AiActionResult.next`). `praxis-ai.md` §6.11.
- 01/11/2026 · JP · Read the handover against the code (§1): nine claims true, two false (no
  `MYCITY_DEMO_GAPS.md`; no Change Report 01, the Mailbox is built), one open point answered (the
  PIN already signs a step-up through `POST /security/confirm`), nine challenges resolved into
  decisions 10 to 27 (§2): the engine as a gated boundary inside this repository rather than four
  packages in another; the existing tables kept and three added; pages stay 25; Excel through the
  one export path with a 25,000-row cap; no streaming, progress over realtime; five PRs instead of
  six; mail and messages as actions the person sends; one AI action for the whole question.
  Written this handoff with the five PRs, their files and their prompts (§4, §5). PR1 started.
- 01/11/2026 · JP · PR1 built (§6.1): the contract, migration 10330, manifest v2, the registry's
  snapshot, authorise for summaries and actions, the engine boundary and gate 24, the card lifecycle
  with the five-minute confirm, read replay, tasks.create, prompt version 4, gates 19 and 23, the
  matrix and the cards suites. Found on the way: the test database of a cloud session lacked
  pgvector (installed by hand; the session hook should); the matrix's first run showed that My
  Profile and ESS's other own-only reads are never a subset of the CEO's, so the subset rule skips
  the own-only module and PR5's probes take it; a `query`/`queries` key is not a write word (the
  queries module's manifest uses it), so gate 19 guards SQL by statement and `.query()` instead.
- 01/11/2026 · JP · PR2 built (§6.2) in one chat, on the session's branch, as praxisjbs/mycity-app#50:
  the Assistant group, the full screen with Back and context on both shells, the pane with Table
  paging through read replay, Record and Sources, progress over realtime. Found on the way: a cloud
  session's image had no node_modules and no Node 20 (both installed by hand again, `npm ci` and
  `/opt/node20`); the Sources tab needs each read's masks and the Table which read the answer's
  table came from, which PR1's wire shapes dropped, so `AiReadMade.masked` and `AiAnswerTable.read`
  were added (History fills them for older answers); the replay route takes only `page`, so the
  Table pages but does not sort yet (PR3, which gives reads their parameters, can add it); Overview
  draws figures and a chart already, so PR3 only has to produce them; the Pager at the capped last
  page keeps a disabled Next rather than none, so the 200-row cap reads as Page 8 of 8.
- 01/11/2026 · JP · PR3 built (§6.3) beside PR2, in its own chat on `claude/clever-pasteur-nt3rsc`:
  the eight summaries, each one SQL in its module's repo with the reader's scope and the dimension
  mapped to SQL by the repo; the read guard; the summary cache; Overview's title rule; Download Excel
  with About This File; prompt version 5; the evaluation set's summary questions. Found on the way:
  a read whose `run` goes through a service on the pool is out of reach of `SET LOCAL`, so the guard
  holds a deadline as well and the summaries all take the client they are given; `ai_message_read`'s
  outcome CHECK had to widen for `timed_out` (10340); the audit module's `ai:none` went with its
  manifest; the first of the month ties every "this month" ranking, so the suite reads ten weeks.
  Touched outside PR3's files: `tests/unit/foundation/ai-assistant.test.js` (mocks
  `allowedSummaries`, since the real manifests now declare summaries) and the audit module's
  controller (the opt-out line). Nothing of `packages/ui` was touched; in `app/`, once PR2 merged,
  only the Table's Export (`Pane.tsx`), the mock's route and a screen test. PR1's
  catalogue snapshot was not on the `main` this branch left (it reached `main` with PR2), so this
  branch carried it whole until `main` was merged in; the snapshot now adds PR3's nine entries.
  Merged as praxisjbs/mycity-app#51 once CI was green on GitHub; the one red run before it was an
  expectation in the new suite that lacked PR2's `masked` on a read. PR4 may start; PR5 waits on it.
- 01/11/2026 · JP · PR4 built (§6.4) in one chat, on the session's branch: ten actions beside their
  modules' reads, the card on both shells, Confirm It's You reordered to a passkey first, suggested
  cards, the drafts held to ready to send, the suites per module. Found on the way: a form's own
  schema rarely names the record the form stands on (a comment's panel is its task, Approve is one
  press on a request), so most cards take a schema of their own (`TaskCommentAdd`, `LeaveApprove`,
  `ApprovalDecide`, `DirectMessageSend`, `MailCompose`) and say `form: "none: <reason>"`, as gate 23
  allows; a card that only knows its records by id cannot be read before it is pressed, so `records()`
  took a database handle and names them through the module's repo; a bulk press that stops at the
  first refusal would leave a manager's four approvals half done, so each record is its own line and
  only a press that did nothing is a refusal; the cloud session lacked pgvector (apt) and Node 20
  (nvm), both installed by hand again; the seeded leave type reads "Annual", not "Annual Leave";
  the password policy refuses a password that holds the email's name. Touched outside PR4's files,
  and said in the PR: `shared/ai/authorise.js` (`checkAction` takes a database handle, `records()`
  may be async), `engine/cards.js` (`fieldsOf` marks a long text), `answer.js` (`draftCard` takes
  the handle and holds the words), `assistant.cards.js` (the same guard at an edit and the press),
  `scripts/check/ai-awareness.js` (offered by any manifest), `app/src/auth/FreshSignIn.tsx` (the
  order, `onConfirmed`), the module services and repos the actions run through. Merged as
  praxisjbs/mycity-app#53 once CI was green on GitHub; PR5 may start.
- 01/11/2026 · JP · PR5 built (§6.5) in one chat, on the session's branch, as praxisjbs/mycity-app#56,
  once release run 73 had sealed `08f6f0b` (PR1 to PR4 and the boot fix #55) on staging. The matrix's
  probes, the attack suite and its nightly run, Spend's three figures with the leak notice, gate 23
  universal, the old Ask retired, the documents final. Found on the way: `policies.read` returned a
  list envelope for one record and the read guard had refused it since it shipped (the attack suite's
  planted-policy case found it; fixed, `policies.md`); the three bulk schemas' limit reached a card
  as Zod's own words ("Array must contain at most 25 element(s)"), now "At most 25"; a scoped module's
  probe cannot use SQL (gate 19 refused `ctx.db.query` in a manifest), so the suite hands probes the
  annual leave type and the probes find #general through the service; a list read's inside record
  may sit past the first page for an all-scope reader, so the matrix walks up to ten pages, which
  also made the subset rule honest for a CEO's list longer than a page; `GET /notifications` carries
  no event key, so the leak notice is found by its title on the urgent list. The `attack` command
  changes `deploy-gate`, so the server's copy must be reinstalled (`deploy.md` §5) before the next
  release and the first nightly pass check-gate; the nightly needs a provider set up on staging,
  else it reads Could Not Run. A cloud session's image again lacked `node_modules`, Node 20 and
  pgvector (installed by hand: `npm ci`, a Node 20 tarball under `/opt/node20`,
  `postgresql-16-pgvector` after `apt-get update`). Performance and Queries carry no probe (their
  records need a plan, a round or a raised query), said so in §6.17.
- 01/11/2026 · JP · The first full run fell on a month's first day and found the suite assumed
  October: the staging reviews seed bound the plans at the real clock, so October's round opened
  with no reviews (on staging too, from 1 November); four screen tests of attendance and the
  calendar read "this month" or moved the clock forward. Fixed in their own commit, each with its
  guide's Change log line (`attendance.md`, `workspace.md`, `performance.md`); the same five fail
  on main today. A cloud session's image lacks Node 20 under /opt and pgvector; both installed by
  hand, and worth adding to the image (`.claude/hooks/session-start.sh` notes the first).
- 01/11/2026 · JP · After PR5, seamless tasks and meetings (§2 decisions 28 to 31, §6.6), on
  `claude/determined-dirac-b4ivrd`: a change missing what its action must have is asked for one
  question at a time with answers to tap, the server's `asks` backing the model; a card carries its
  form's fields, names what they hold apart from its records and is edited with the screens' own
  pickers; watching a task gives sight of it, and New Task and the task card name watchers;
  `colleagues.list` lets anyone name a colleague. Found on the way: a watcher who stopped watching
  was answered 404 by the panel's reload (now the panel once more, then it closes); the colleague
  list leaves its reader out, which would have broken the matrix's subset rule, so the read lists
  everyone; `CardPicker` already named a form component, so the card's slot type is
  `ActionCardPicker`. A cloud session's image again lacked Node 20, pgvector and `node_modules`
  (installed by hand: nvm's Node 20 linked at `/opt/node20`, `postgresql-16-pgvector`, `npm ci`).
- 02/11/2026 · JP · praxisjbs/mycity-app#57 merged with Squash and merge as `c7195d8`, its six CI jobs
  (scope, checks, backend, frontend, screens, ci) green at the first run and no review thread open;
  staging takes it with the next release. Left: run the evaluation set's follow-up and card cases
  on staging with the real model (`node scripts/ai/eval-assistant.js --only=ask`, `--only=card`).
- 02/11/2026 · JP · Answers that read well (§6.7), after JBS Praxis asked on staging who was absent
  and got a register with no names, statuses as codes and "nobody is absent": a table now names
  its records and reads codes as words, the Table pane draws by the same rules, a question for a
  card always has its answers to tap, prompt version 8 answers "absent" in the person's sense, and
  Open Figures sits only under an answer with a table or figures. Left: the evaluation set on
  staging with the real model.
- 03/11/2026 · JP · A card never shows an id (§6.8, decision 32), after JBS Praxis asked on staging
  whether a Request Leave card's leave type shown as an id was deliberate: Request Leave names and
  picks its type and asks which one with the days left of each, a type the model writes by name is
  matched on the server, and a picked id nothing names is marked Pick one and never sent. The leave
  cards' test now books working days only. Left: the evaluation set on staging with the real model.
- 03/11/2026 · JP · Decision 32 finished (§6.8): on staging a Request Leave card still read "Annual
  Leave" with Pick one, because the model wrote "Annual Leave" and the type is named Annual. The
  match now takes a type with or without the word Leave, a card keeps what was matched while another
  field is fixed, an id field never shows the model's own words, and the pane no longer goes blank
  after a card drawn from what was said.
- 03/11/2026 · JP · The forms gate (§6.9, decision 33): gate 23 rule 6 holds every create and edit
  form of a built module to an action, a via, a never word or the list of today's gaps (89 of 116),
  which only shrinks. Next: the forms themselves, Workspace and Calendar first.
- 03/11/2026 · JP · Workspace and Calendar's forms in the chat (§6.9, decision 33): ten cards
  through the screens' own services, each edit naming its record and showing only what changes;
  Late Reasons held to their capability as their routes are (`capability` on an action, the
  matrix's rule handed the tool); a step and a late reason matched by their words, a week by any
  day in it; `tasks.get`. 79 gaps left. Next: People.
- 03/11/2026 · JP · A card is drawn whole (§6.10, decision 34): every required field is asked before
  a card is drawn, gate 23 rule 7 holding it; a lead is asked when a task is shared with a department;
  a record is asked with the person's own to tap and matched by its words. Next: Home and Settings.
- 03/11/2026 · JP · Home and Settings' forms in the chat (§6.9, decisions 33 and 35): eighteen cards
  through the screens' own services; four structure forms `design` (owner's choice), the push
  subscription `device`; a card changing part of a whole holds it to the form's own schema; `view`
  with a capability for Home's alert rules and reports. 57 gaps left, all in the parallel chats' areas.
- 03/11/2026 · JP · People, Queries & Sanctions and Policies in the chat (§6.9, decision 33), beside
  two other chats (Performance, Community and Mailbox; Home and Settings). Four questions put to
  JBS Praxis first, their answers decisions 36 to 39 (`praxis-ai.md` §1.8): an employee's card
  carries the work record alone and asks for every field it needs; a place on a card is picked now
  (our search signs only one match, else Pick one and AddressField on Edit), rather than leaving
  the address forms as gaps; the saved signature signs a query, and the chat says plainly it cannot
  draw one (Draw Signature opens Edit Signature); Confirm It's You for Raise Query, Record Leave,
  Save Type and Approve Overtime. 25 cards, 26 forms off the list, 31 left after Home and Settings. Found on the way: an
  action with `picks` but no `names` never marks Pick one (Approve Overtime names its person now);
  the matrix caught record probes that left out the person's id; a resolver that throws is
  swallowed by the engine (the maps service's wrong logger import passed the integration suite and
  only its unit test found it); a policy version's column is `status`, not `state`. Rebased onto
  #67 (decision 34, a card drawn whole) and #69 (decision 35, `design`), which took those numbers,
  so these are 36 to 39 (§1.8), and gate 23 rule 7 asked a question for each record a card names: whose, from People's
  register (`read: employees.list`), which department, open role, worksite or policy from their
  list reads, and which rule, step, letter, leave type or open query to tap (`options`). A cloud
  session's image again lacked Node 20, pgvector and `node_modules` (installed by hand: nvm's Node
  20, `postgresql-16-pgvector`, `npm ci`).
- 03/11/2026 · JP · Performance, Staff Community and Mailbox's forms (§6.9, decision 40), on
  `claude/ecstatic-cori-rplleb` beside two other chats (People, Queries & Sanctions and Knowledge
  Hub; Home and Settings): the check-in, the scores and PIPs, announcements and the signatures put
  to the owner; the guides written first. 31 forms become 32 actions (sharing a goal and an
  objective are two cards, a scorecard's lines Add Line and Save Line).
- 03/11/2026 · JP · Performance, Staff Community and Mailbox's forms built (§6.9, decision 40): 32
  cards, each the screen's own service; Performance's records named by their codes, persons and
  words; Save Score and the PIPs behind Confirm It's You; an action may hold any one of several
  capabilities. Found on the way: New Key Result's form validates with `KeyResultCreate` through a
  typed call that gate 23 did not read (fixed in the gate); Save Scores clears every corrective
  action it is not sent, so the one-line card sends the others as they stand; New Channel posts its
  purpose after it creates the channel, and the card does the same. No gaps left with Home and
  Settings (praxisjbs/mycity-app#69) and People, Queries and Policies (praxisjbs/mycity-app#70).
- 03/11/2026 · JP · Performance, Staff Community and Mailbox's forms rebased on the card drawn whole
  (decision 34, praxisjbs/mycity-app#67), Home and Settings (decision 35, praxisjbs/mycity-app#69) and
  People, Queries and Policies (decisions 36 to 39, praxisjbs/mycity-app#70), all merged first, in
  praxisjbs/mycity-app#68: the decision renumbered 40 (`praxis-ai.md` §1.9), and gate 23 rule 7 met
  by all 32: each asks for its record with the person's own to tap (`options` from the module's
  service, `read` for colleagues, channels and departments), what a line or a KPI needs, the month,
  and with `when` what a state needs (a share's departments, a corrective action's due day, a new
  reviewer's reason). `named.choiceWords` (additive) fits a record's words in an answer; a review
  and a scorecard are matched by person and month or quarter too. Two evaluation cases reworded so
  they say what the card needs, two question cases added.
- 03/11/2026 · JP · The evaluation set's first run on staging (TB, the real model; 100 card questions,
  9 asking ones). Most failures were the questions: every question was asked as the first holder of
  its role by email, about records staging does not hold (a "weekly report" task the asker did not
  have, Lovellyn Ade as a head of department's report, records only another question would make
  though the set writes nothing, a Sales department), or grading correct behaviour as failure (a
  binding plan's objectives declined, a typed address left to pick). Three were the product: Save
  Targets, called as though it were a read, came back "not available" to someone who may make it;
  Create Task "for me" carried the person's own name, which the lead matcher never looked at, and the
  card's names sent the words to a uuid query; Set KPI's "95%" was refused as a figure. All three are
  fixed; the set now fills each question from the asker's own records (a card's own question's first
  answer among them), skips what staging lacks and says what a failed card's fields held. Next: the
  rerun on staging (§6.9).
