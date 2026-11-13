# Praxis AI · Engineering Guide

| | |
|---|---|
| Owner | TB, with GE |
| Milestone | M10 (brought forward, 21/10/2026) |
| Backend modules | `assistant` |
| Frontend paths | `app/src/features/assistant/` |
| Permission key(s) | `praxis_ai` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | Praxis AI · Ask and History (#67, #68) |
| Status | Built |
| Last changed | 13/11/2026 |

Sources: MILESTONES §15 (M10's assistant, its definition of done) and A23 (it reads; since
01/11/2026 it acts only through a declared action a person confirms, §1.2), BACKEND_STRUCTURE §14
(the AI pipe, the manifests, the registry), `ai-control.md` (jobs, chains, decision 22), REUSE_MAP
§11, the M1 handover meeting of 21/10/2026 (00:42:41 to 00:45:03, Ifeoma's request), the decisions
of 21/10/2026 below, and the Praxis AI Engine handover of 01/11/2026 checked and resolved in
`docs/handoff/praxis-ai-engine.md` (§1.2 here; the build plan, its five PRs and their prompts live
there).

---

## 1 · What it is for

A member of staff asks a question about MyCity's work in plain words ("who is late today?", "what
has Aisha done today?", "which leave requests are waiting on me?") and gets a short answer from the
records they are allowed to see, with the records it read and a button to the screen where they
would act. Everyone with Praxis AI uses it; what each person can learn from it is exactly what
their own screens would show them, and nothing more.

### 1.1 Decisions (21/10/2026, binding)

1. **The whole database, through the modules' reads, never through SQL.** Praxis AI reaches every
   module through the reads that module declares in its `<module>.ai.js` (BACKEND_STRUCTURE §14.3),
   each run with the asking person's grant, scope and field masking (`shared/ai/authorise.js`).
   The model never writes SQL (`ai-control.md` decision 22 stands). New rows are answered from at
   once; a new module is reachable as soon as it ships its manifest, which gate 9 requires.
2. **Up to 5 reads per question.** One question may need several reads ("what happened today"
   reads the roster, the exceptions, the leave waiting and the alerts). The model may run up to 5,
   one after another, each checked as above. This changes `ai-control.md` decision 22, which said
   one read. A day's summary is an example of such a question, not a feature of its own.
3. ~~**It answers, it never acts** (A23). Asked to change something, it offers the screen where the
   person makes the change, prefilled where the screen takes it (the manifests' `routes`).~~
   *Replaced 01/11/2026 by decision 10 (§1.2): it acts only through a declared action a person
   confirms; a prefilled screen stays the fallback for a change no action declares.*
4. **Voice in, not voice out.** Ask carries the shared `VoiceField`: the question is recorded,
   transcribed on the Transcription job, and lands in the box to be checked and sent. Answers are
   read, not spoken.
5. **The name is held in one place.** "Praxis AI" (MILESTONES §18.1) is written in the two module
   catalogues (the shell's `catalogue.ts`, the server's `access.catalog.js`) and the system prompt's
   first line. The screens and the floating button read it from the shell's catalogue, and a message
   or the Audit Log says "the assistant", so a different name is a three-line change if MyCity asks
   for one (Ifeoma used "Shi" in the meeting; JBS said it could be renamed).
6. **The Knowledge Hub is not built here.** Its articles (SOPs, FAQs, training) live in
   `knowledge_article` and `knowledge_article_version`, their vectors in `knowledge_embedding`
   (migration `10000`). When the Knowledge Hub is built, it ships a search read in `knowledge.ai.js`
   and Praxis AI uses it like any other read. Policies are answered today (`policies.read`,
   `policies.list`, `policies.mine`).
7. **History is the person's own**, whatever scope their `praxis_ai` grant carries. Nobody reads
   another person's questions; the spend of everyone's questions is on AI Control · Spend.
   *Amended 22/10/2026 (History brought to the demo):* a person who holds AI Control `view` also
   sees the company's figures on History: everyone's questions this month, Praxis AI's spend this
   month, the monthly cap, spend per month and questions by module. Counts and naira only; nobody's
   questions. Everyone else sees the same layout with their own figures.
8. **Tables come from the rows, not from the model.** When an answer carries a table, the model
   names which read and which fields; the server draws the rows from what that read returned. The
   model's words are provisional; the figures in a table are the records'.
9. **From names the kinds of record, not every record** (22/10/2026). An answer's From lists the
   record types it was read from and how many of each ("partnership ×4", "interaction log",
   "employee ×2"), as the demo does. A record is named on its own only when the whole answer rests
   on that one record. The individual records open from the answer itself: each row of its table
   opens its record.

### 1.2 Decisions (JBS Praxis, 01/11/2026, binding): the engine

From the Praxis AI Engine handover, checked against the code and resolved in
`docs/handoff/praxis-ai-engine.md` §1 and §2, which hold each decision's reason and the PR that
builds it. The old rule "it answers, it never acts" was JBS's own scoping choice for the first
build, not a MyCity requirement; JBS lifts it, and MILESTONES §15 carries the amendment.

10. **The AI acts only through a declared action a person confirms.** The model proposes an action
    and its values; the server validates them against the action's contract schema, checks the
    person's rights, stores the card and shows it; the person's press runs the module's own service
    function once, with their own rights re-checked at the press (§6.11). The model never calls an
    API and never says something was done before the result line does.
11. **One press for `standard` actions; `approval`, `money`, `payroll` and `delete` need Confirm
    It's You within the last five minutes** (a passkey first, else the PIN, else the password,
    through `POST /security/confirm`; 403 `REAUTH_REQUIRED` past the window, as My Security does).
12. **Full screen from any screen, with Back** and the opening screen's context (PR2).
13. **The right pane: Overview, Table, Record, Sources** (PR2, PR3).
14. **Pages stay 25; the model reads figures.** Summary reads run in the database (§6.13); the
    model sees figures and each read's first page of 25; five reads a question; the pane's Table
    pages at 25 up to 200 rows, then Excel.
15. **Excel through the one export path** (`foundation.md` §6.12), at most 25,000 rows, with an
    About This File sheet (PR3).
16. **The same rights everywhere, re-checked at the press**: grant, scope in the query, masks after,
    and at the press the grant, the scope on each record, the approval chain and the record's state.
17. **The engine is a boundary, not a repository**: `services/ai/engine/` pure and gated (§6.14);
    extraction to JBS Praxis's own repository is a later PR there.
18. **The existing tables stay; `ai_message_read`, `ai_action_draft` and `ai_action_run` are added**
    (§4).
19. **Mail and messages are actions; Praxis AI reads neither** (`mailbox.md` §9, `community.md` §9
    stand): the person presses Send (PR4).
20. **A suggested card**: at most one action the person did not ask for, marked suggested, never run
    unasked; one card per answer.
21. **Actions live in the module's manifest beside its reads** (`summaries` and `actions` next to
    `reads` and `routes`); the engine knows nothing module-specific.
22. **The engine is told when a form, a payload or a schema changes**: gate 23 (§6.15).
23. **No streaming; progress over realtime** (PR2).
24. **The system turn is a stable, cacheable prefix** (§6.1).
25. **One AI action for the whole question**: Data Answers, one run per question (§6.7).
26. **Proof in CI**: the matrix generated from the registry on every PR; the attack suite scripted
    on every PR and nightly on staging with the real model (PR1, PR5).
27. **The old Ask retires in PR5**, once the full-screen Praxis AI, the pane and the cards are on
    staging.

### 1.3 Decisions (JBS Praxis, 01/11/2026, binding): seamless tasks and meetings

Taken after the first cards were tried on staging (a task shared with TBO came back with codes for
names, "employee" for its assignee and a problem Edit could not clear). Each answer was put to the
owner with a recommendation first; the reasons are in `docs/handoff/praxis-ai-engine.md` §2.

28. **A change that is not complete is asked for, one question at a time, with choices to tap.**
    Before it draws a task or a meeting, Praxis AI asks for what its action still needs, one short
    question per answer, and offers the answers as choices under the question when there are few
    (Today, Tomorrow, Friday, No Due Day; each matching person by name and job title). A tapped
    choice is sent as the person's next question; typing an answer works as well. The card is drawn
    once nothing is missing. It is the same Data Answers run as every question (decision 25).
29. **What is always asked.** A task: what it is, when it is due (or that it has none) and how
    urgent it is. A meeting: what it is about, its day and start, how long it is and who comes (or
    nobody but the person). Anyone named: which one, when the name matches several people. The model
    asks first; the server holds the same list (each action's `asks`, §6.11), so a card drafted with
    one missing becomes that question instead, and each is asked once in a run of questions.
30. **Watching a task gives sight of it** (amends `workspace.md` §6, "watchers are only people who
    can already see the task", 23/10/2026). A watcher may open the task, read and add comments, and
    hears when it is done, blocked, unblocked, cancelled or commented on; it never lands on their
    board as their work, and they cannot move, edit or block it. Watchers, people or a whole
    department (its active people when the task is saved), are set on New Task and on the task card;
    the panel's Add Watcher takes any colleague.
31. **A card names everything it holds and edits every field.** People, departments and projects
    read by name, named through the action's own module (`names`); the verb counts only the records
    a press acts on, never the people named on it; Edit picks people, departments and projects with
    the pickers of the screen's own form; a card carries only the fields its form offers (`fields`);
    and a rule a schema cannot say to the model (a task is shared with people or a department, never
    both) is in the action's description.

### 1.4 Decisions (JBS Praxis, 03/11/2026, binding): a card never shows an id

Taken after a Request Leave card on staging showed its leave type as an id, marked Not offered, and
a task card showed an id where a person should be. Put to the owner with a recommendation first.

32. **A card never shows an id, and a leave request asks its type.** Every id a card holds reads by
    name, through the action's own module (`names`); an id that names nothing (one the model wrote
    from no read, or a record retired) is never printed: its field is marked Pick one and Edit picks
    it with the screen's own picker. Request Leave names its leave type and picks it as Request
    Leave's form does; asked for leave without a type, Praxis AI asks "Which leave type?" with the
    person's own types and the days left of each as answers to tap. A field the model may write by
    name (a leave type) is matched to the person's own records on the server (`resolve`), so a type
    is never an id the model made up.

### 1.5 Decisions (JBS Praxis, 03/11/2026, binding): every form in the chat

Asked for on 02/11/2026 ("any new forms (create and edit) there should be a gate to ensure that we
have them") after the list of the hub's forms showed five of about 76 create and edit forms
reachable from the chat; the gate's shape was put to the owner first and approved on 03/11/2026.

33. **Every create and edit form is in the chat, or never for a named reason.** Each create and
    edit form of a built module, its contract's `<Thing>Create`, `Edit`, `Update`, `Patch` and
    `Save` schemas, is an action Praxis AI drafts as a card; or is reached through another action's
    card (`via <action>`: the chat box's message through `community.message`); or is never in the
    chat, for one of five reasons (six since decision 35, `design`): `secret` (passwords, PINs, passkeys, keys, connections and the
    security policy), `device` (made on the person's own device at the site), `personal` (personal
    data the assistant never writes), `file` (an upload) or `ai` (the AI's own controls). The forms
    not in the chat on 03/11/2026 are listed in `scripts/check/ai-forms-gaps.json`, and that list
    only shrinks: a new form, and every form of a module when its backend is built, comes with its
    action or its reason. Gate 23 holds it (§6.15 rule 6).

### 1.6 Decisions (JBS Praxis, 03/11/2026, binding): a card is drawn whole

Asked for on 03/11/2026 after a Create Task card on staging, shared with a department, was drawn
without its lead and refused at the press with Pick a lead ("It should always ask for required
fields, so we never see an error. We can add a gate for that.").

34. **Every field a card needs is asked before it is drawn.** Each field an action's input requires,
    and each field it requires only in some states (`when`: the lead of a task shared with a
    department), is asked first, one question at a time with answers to tap; a field that names a
    record (which task, which request, which channel) is asked with the person's own records as its
    answers and matched by their words. So a card is pressed as it is drawn: a problem left on it is
    one the person made by editing it, never one nobody asked about. Gate 23 holds it (§6.15
    rule 7): every required field of every action's input has an ask. **A card showing a problem
    is never pressed**: the verb waits and Edit stands in its place until Save Changes clears it,
    since the press's re-check would refuse it (`ActionCard`; faults #1 and #8 of the 11/11 brief,
    where a card drawn with Pick one was pressed and refused, `VALIDATION` at the confirm).

### 1.7 Decisions (JBS Praxis, 03/11/2026, binding): a structure is designed on its screen

Put to the owner with a recommendation first when Home and Settings came into the chat ("go ahead
with Home and Settings"): four forms edit a whole structure, and none of decision 33's five reasons
fit them.

35. **A structure is designed on its own screen** (amends decision 33). A form that edits a whole
    structure with all of it in view is never in the chat, for a sixth reason, `design`: a role's
    grants (Save Role, so who may do what never changes from the chat), an approval chain's stages
    and approvers (New Approval Flow, Edit Approval Steps) and the Home cards each role sees and
    locks (Save Home Role KPIs). Praxis AI opens the screen, where the person saves it with its
    own button. Gate 23 reads `design:` as it reads the other five words (§6.15 rule 6).

### 1.8 Decisions (JBS Praxis, 03/11/2026, binding): People, Queries and Policies in the chat

Put to the owner before People's, Queries & Sanctions' and Knowledge Hub · Policies' forms came into
the chat (decision 33), each with a recommendation first; the owner took each recommendation but the
second, choosing that cards pick a place now.

36. **An employee's card carries the work record alone, and asks for what the record needs.** Add
    Employee and Save Record carry names, work email and phone, job, department, line manager,
    worksite, engagement, work pattern and the engagement's dates; birth date, gender, next of kin,
    home, personal email, bank and pay are never on a card and stay on the record's own screen. Add
    Employee asks for every field the record requires before its card is drawn ("required fields
    must be filled", as decision 34 asks of every card), and a card missing one is never pressed.
37. **A place on a card is picked, never typed (F27).** The model writes an address in words; our
    address search signs it only when exactly one place matches; several, none or the search down
    leave the field marked Pick one, and Edit picks the place with the screen's own AddressField (the
    `place` pick). So Add Worksite, Save Worksite and Add Work Site are cards; a worksite's centre is
    its place's point, and a card never makes a Temporary Home (a home is personal data).
38. **A letter is signed with the signature the person saved; the chat never draws one.** Raise
    Query signs its letter with My Signature, as the screen's pad opens with it; without one the
    press says plainly that Praxis AI cannot draw a signature, and Draw Signature opens Edit
    Signature. Save Letter Signature is never in the chat (`file:`), and asked to save a signature the
    assistant says it cannot and opens Edit Signature, so it never reads as a gap.
39. **Confirm It's You for what decides pay, leave or discipline.** Raise Query, Record Leave, Save
    Type (a leave type's allowance) and Approve Overtime are risk `approval`; the other cards of these
    modules are one press.

### 1.9 Decisions (JBS Praxis, 03/11/2026, binding): Performance, Staff Community and Mailbox

Decision 33's next three modules. Four questions were put to the owner on 03/11/2026, each with a
recommendation first; three recommendations were taken and the fourth chosen.

40. **Performance, Staff Community and Mailbox in the chat.** The monthly check-in is a card per
    line, Save Check-In: the line named by its words, saved to the draft through My Performance's
    own save; a file and Submit Check-In stay on My Performance. A reviewer's scores (Save Score,
    one line at a time) and improvement plans (Start PIP, Save PIP) are cards of risk `approval`,
    so every press asks Confirm It's You (the owner's choice, over scores in the chat and PIPs
    never); `performance.md` §8 still keeps a review's comments and a plan from every read the
    assistant makes. An announcement publishes, or saves while it waits, with one press as the
    screen's own button does, for holders of `announcements.post`, the card naming its audience,
    its urgency and when it goes out. Both signatures are cards in full: My Signature's mobile is
    written to the employee record as the Signature tab writes it, and Configure is for holders of
    `mailbox.signature`. Neither signature form carries an image: the logo and the icons are the
    company's brand files on Settings · Organisation.

### 1.10 Decisions (TB, 13/11/2026, binding): a document in the chat

TB asked whether a person could attach an invoice or a receipt to the chat and have Praxis AI make
the record from it, with JBS Praxis's invoice INV-202611-9525 as the sample (four items, a discount
line of -₦100,000.00, a total of ₦450,000.00, ₦300,000.00 paid to date and ₦150,000.00 due, payable
to Nombank MFB 5589994089). Eight questions were put, each with a recommendation first; the answers
are below. §6.18 is the design and Appendix A the build plan.

41. **Three kinds of document, picked before the file.** Attach Document opens a modal: the person
    picks what the document is (**Invoice**, **Payment Receipt**, **Contract or MoU**), then the
    file. The three tiles are what tells a person what may be attached; nothing else can be. A kind
    is offered only to someone who may make what it becomes: Invoice to `expenses` create, Payment
    Receipt to a holder of `expenses.finance` (it records a disbursement), Contract or MoU to
    `partnerships` view (its filing card needs `partnerships` edit, as the screen's own buttons do).
    The kind tells the server which reading to run, so a guess never decides it.
42. **PDF and images, no Word.** PDF, JPEG, PNG, WebP, HEIC and HEIF (a phone's photos): every kind
    the Image Reading model reads itself, "as many as we can build for". Word, spreadsheets and
    anything else are refused at upload. One file a question, at most 10 MB (the AI client's
    `FILE_MAX_BYTES`).
43. **Read on Image Reading, chosen by TB.** Each kind's reading is a registered action on Image
    Reading (`ai-control.md` §6.2), `personal_data: true` (an invoice names people and bank
    accounts, so DeepSeek never reads one), `chosen_by: "TB"`, `chosen_at: "2026-11-13"`. An
    invoice reuses Read Invoice's own action, `expense-invoice-read` (AJ's), widened; a payment
    receipt is `disbursement-receipt-read`; a contract or MoU is `agreement-document-read`.
44. **The model reads; the server decides the figures.** The kind's reader returns structured
    fields, never free text to act on. The chat's model sees that result as a read (cited as the
    document) and drafts the card; the server then sets every field the file gave from the
    reader's result, not from the model's words: amounts through `shared/money` and totals counted
    again, a category among those offered, an account number of ten digits, a partner, agreement or
    request matched among the person's own. The person checks the card, the file one press away,
    and presses. Nothing is saved before (A23 as amended).
45. **An invoice asks for its balance due, itemised.** Each item is a line, a discount a line with
    a negative unit price, and a payment already made one more negative line ("Paid to date on
    INV-202611-9525"), so the request totals the balance due and the approvers see the whole
    invoice. A request's line may therefore carry a negative unit price; its total is always above
    zero. The invoice number is written into the purpose, and the file becomes the request's
    invoice.
46. **A payment receipt records a disbursement.** Its bank reference, day paid, amount and
    beneficiary are read; the server matches the authorised request it pays (by the beneficiary's
    account number, else the payee's name, and the amount) among those the person may pay. One
    match fills the card, several ask which, none leaves the request to pick. The receipt becomes
    the disbursement's receipt. Record Disbursement keeps its risk class `money`, so its press asks
    Confirm It's You.
47. **A contract or MoU is summarised, then filed.** The answer summarises the parties, the dates
    (signed, start, end, notice), the money, renewal and each side's main obligations, and shows
    them on the pane's Record tab; a card under it files the document: Record Signed Copy when it
    matches an agreement on Partnerships · Contracts & MOUs that waits for its signature, otherwise
    Add Partner Document on the partner or lead it names. Nothing else is made from it: no agreement
    is drafted and no partner created.
48. **Two pull requests, each in a fresh chat** (Appendix A): the attach control with invoices and
    payment receipts first, then contracts and MoUs.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Praxis AI · Ask (`ask`) | Staff app: the full screen, from every screen (the top bar's Praxis AI on desktop; the floating button's on a phone), ⌘K and the menu | `praxis_ai` view | The conversation beside the right pane (Overview, Table, Record, Sources) with Back to the screen it was opened from and Recent behind a toggle; on a phone opened from a screen, the conversation full width with the pane as a sheet from Open Figures; opened from the menu, the person's conversations first; Try Asking when it is empty | Ask (typed or recorded), Back, tap an answer under a question Praxis AI asks before a card (decision 28), open the pane (a chip, Open Figures), page a table, Download Excel on the Table (§6.16), open a record, Open the offered screen, Show Next 25, Helpful or Not Helpful, New Conversation |
| Praxis AI · History (`history`) | Staff app | `praxis_ai` view, own questions only; the company's figures with `ai_control` view | This month's questions, your questions and spend (and the monthly cap for AI Control); your questions, 25 a page, with their sources, tokens and cost; spend per month; questions by module | Open a question's conversation on Ask, Delete Conversation, Clear History, Export, search questions |
| Floating button (phone) | Staff app, every screen with the button | `praxis_ai` view | Praxis AI in the fan (F18): it opens Praxis AI · Ask full screen with the screen the person was on as `from`, the question's context and where Back returns (decisions 12 and 27) | As on Ask |
| ⌘K | Staff app | `praxis_ai` view | Ask, History, the person's own conversations, New Conversation | Open them |
| AI Control · Actions | Staff app | `ai_control` view | Data Answers marked built; the new Voice Question action; Data Answers' chain takes any text model as first choice or fallback | As built (`ai-control.md`) |
| Every module's manifest | Backend | | The reads, summaries and actions Praxis AI may run and the screens it may offer | Gains reads where a question needs one (§6.9), summaries for its big tables (§6.13, PR3) and actions for the changes people ask for (§6.11, PR4) |
| An action card | Inside an answer, on the full screen and in the phone's chat | The person who asked, for an action their grant allows | The action's name, the fields its form offers as it will receive them (as a person reads them: people, departments and projects by name, decision 31), the records it acts on named and linked, a problem on its field, the buttons; the result line after the press, one line per record; Expired with Draw It Again | Press the verb (with the count when it acts on several; Confirm It's You first for a sensitive class; not offered while a field shows a problem, Edit standing in its place), Edit (the fields through the form system, people, departments and projects with the screen's own pickers, Save Changes), Cancel; a suggested card reads as a question with Not Now |
| Praxis AI · Ask, Attach Document (Appendix A: invoices and payment receipts built in PR 1; contracts and MoUs in PR 2) | Staff app: beside the question box, on the full screen and in the phone's chat | `praxis_ai` create, and the grant each kind needs (decision 41) | A modal: the kinds the person may attach as tiles, then the file; the question's bubble then carries the file | Attach an invoice or a payment receipt (a contract or MoU from PR 2), and get its card (§6.18) |

## 3 · How the screens relate

1. A person types a question on Ask, or presses the microphone: `VoiceField` records, the audio is
   uploaded through the upload engine, and `POST /ai/transcribe` returns the words into the box.
   They check it and send.
2. `POST /ai/ask` (`AiAsk`: the question and, after the first, the conversation; the screen it
   was asked from as `context`, read from the full screen's `from` address or the screen under the
   phone's chat, and `shows: ["pane"]`). The service checks governance (AI on, Praxis AI's module
   switch, the overall cap), opens or continues the conversation, and builds the turn (§6.1): who
   is asking, today in Lagos, the screen asked from, the screens they may open, the reads they may
   run as tools, the last 10 turns.
3. The model answers with read calls or with its answer. Each read runs through
   `authorise.runRead` with the person's own rights (§6.3) and its page goes back to the model as
   data; before it runs, `ai:progress` is pushed to the person's realtime room (§6.1.8), so the
   screen says what is being read. At most 5 reads; then it must answer with what it has.
4. The answer (§6.4) is checked against its schema, its table drawn from the rows, its screen
   button resolved from the manifest's route, its citations taken from what the reads returned
   (`shared/ai/cite.js`). The question, the answer and the citations are saved in one transaction
   with `emit("assistant.answered")`, and the answer returns to the screen.
5. A citation opens its record (`route-map.linkFor`, worked out when shown). The screen button opens
   the owning screen with its prefill; the person makes the change there.
6. History lists the person's conversations; opening one returns to Ask with that conversation
   (`?id=`). Delete Conversation and Clear History remove the words; the ledger keeps the spend.
7. AI Control · Spend counts every question under Data Answers and every recording under Voice
   Question, by the run each one opened.
8. On a phone, Ask opened from the menu or History opens on the person's conversations, newest
   first, with New Conversation; a conversation, or New Conversation, opens the chat full screen
   over the list, and the phone's Back returns to the list (a History row's `?id=` opens its chat
   the same way, and the address goes back to the list's). Inside the chat, Conversations opens the
   person's other conversations as a sheet, as Staff Community's channels do inside a channel, and
   New Conversation starts another (`PhoneChat.tsx`). Opened from a screen, by the floating button's
   Praxis AI, ⌘K on a screen or a link with `from`, Ask is the one full screen (`index.tsx`,
   decision 27): the conversation full width with Back to that screen, the pane as a sheet from
   Open Figures, and that screen as every question's context. An answer's screen button or a cited
   record goes there; Back, Escape and the phone's own Back return to the screen as it was.

## 4 · Data

Migration `10310_assistant.sql` (M10's block). The tables are `10000`'s; this build widens two.

| Table | Key columns | Notes |
|---|---|---|
| `ai_conversation` (10000) | `user_id`, `title` (the first question, cut at 120 characters), `status` (`active`), adds `last_asked_at`, `questions` (10310) | One per conversation, always the asker's own. Index (`user_id`, `last_asked_at` desc) |
| `ai_message` (10000) | `ai_conversation_id`, `parent_message_id` (an answer's question), `role` (`user`, `assistant`, `system` as seeded in `10099`; CHECK added in 10310), `content` (the question, or the answer's words), `ai_run_id`, `feedback` (`up`, `down` or null; CHECK added), adds `rows_read` (the rows its reads returned) and `module_key` (the module of its first read) (10310), `metadata` | History reports on `rows_read` and `module_key`, so they are columns. An answer's `metadata` holds what is only shown: its table (columns, rows, numeric columns, and each row's record as type and id, whose link is worked out when shown), its screen button, the reads it made (key, rows returned, total), `declined` and `more`. Indexes on the conversation, the parent and the run (10310) |
| `ai_message_citation` (10000) | `ai_message_id`, `label`; adds `entity_type`, `entity_id`, `read_key` and `position` (the order the answer cited them in) (10310); `knowledge_article_version_id`, `document_id` stay | 10000's CHECK required an article or a document; 10310 widens it to accept a record (`entity_type` and `entity_id`) |
| `ai_run`, `ai_run_step` (M0, 10200) | `purpose` `data-answers` or `praxis-ai-voice` | One run per question, one step per round with the model. No question or answer text is kept here |

Migration `10330_praxis_engine.sql` (decision 18; PR1) adds the engine's tables and widens two:

| Table | Key columns | Notes |
|---|---|---|
| `ai_message_read` (10330) | `ai_message_id` (cascade), `n` (1 to 5), `read_key`, `kind` (`read`, `summary`), `module_key`, `params` jsonb, `page`, `rows`, `total`, `outcome` (`read`, `refused`, `invalid`, `failed`), `masked` text[] | Each read of an answer, with its parameters, so a later page (`GET /ai/answers/:id/reads/:n`), the Sources tab and an Excel file are rebuilt from the records with the person's rights now, never from the model. UNIQUE (`ai_message_id`, `n`) |
| `ai_action_draft` (10330) | `ai_message_id` (cascade), `user_id`, `action_key`, `module_key`, `risk` (`standard`, `approval`, `money`, `payroll`, `delete`), `values` jsonb, `problems` jsonb, `records` jsonb, `suggested`, `status` (`shown`, `confirmed`, `done`, `failed`, `cancelled`, `expired`), `expires_at` | The card (§6.11): one per answer, the asker's own, valid 30 minutes. Index (`user_id`, `status`), (`ai_message_id`) |
| `ai_action_run` (10330) | `ai_action_draft_id`, `user_id`, `confirmed_how` (`click`, `fresh_sign_in`), `idempotency_key`, `values` jsonb (as run), `result` jsonb (a line per record), `status` (`running`, `done`, `failed`), `error_code`, `started_at`, `finished_at` | The press and what came of it; the audit's `assistant.action_confirmed` names it. One per press; a second press of the same card is refused or replays |
| `ai_catalogue` (0095) | `kind` widens to `summary` and `action`; adds `risk` | The deployed build's reads, summaries, actions and routes (`catalogue-sync.js`) |
| `ai_conversation` (10000) | adds `opened_from` jsonb | The screen the conversation was opened from (decision 12), as `AiScreenContext` |
| `ai_message` (10000) | adds `context` jsonb | The screen context sent with the question, kept for History |

Migration `10350_praxis_attack_run.sql` (PR5, §6.17) adds `ai_attack_run`: one row per run of the
attack suite against the real model (`environment`, `run_by` nightly or hand, `status` passed,
leaked, cannot_run or failed, `asked`, `passed`, `leaks` as a line per leak naming the attack, who
asked and what was wrong, never a record, `error_code`, `started_at`, `finished_at`), read by AI
Control · Spend through AI Control's service (`ai-control.md` §4).

Migration `10340_praxis_read_timeout.sql` (PR3) widens `ai_message_read.outcome` to `timed_out`: a read
or summary the database cut at the 3 second statement timeout (§6.3 step 8), so the Sources tab can
say the question covered too much. An answer's Excel file (§6.16) is a `document` of type
`ai_answer_export` (`export: true`, personal, the asker's own, kept 24 hours by the vault's sweep),
reserved in the request and filled by the worker; no table of its own.

Migration `10360_praxis_card_names.sql` (decision 31) adds `ai_action_draft.names` (jsonb, an empty
list by default, never null): the people, departments and projects a card's fields hold, each as
`{ type, id, label }`, named through the action's own module at the draft, an edit and the press and
kept apart from `records` (what a press acts on), so the verb never counts a person named on the
card. A question Praxis AI asks before a card (decisions 28 and 29) keeps what it asks for in its
answer's `metadata.ask` (`{ action, field, choices }`), shown as its answers to tap and replayed to the
next question; no column.

No reference seed: `praxis_ai` grants are `0290`'s. Nothing is seeded on production; staging's
conversations come from asking.

## 5 · API

Under `/api/v1/ai`, schemas in `packages/contract/schemas/assistant.js`.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /attachment-kinds` | → `AiAttachmentKinds` | `praxis_ai` view | no | The kinds the caller may attach (decision 41), each with its label and question, and whether reading is available now (§6.18) |
| `POST /ask` | `AiAsk` (`question` up to 500 characters, empty only beside an `attachment` (`{ document_id, kind }`, §6.18), `ai_conversation_id` optional, `context` optional: the screen asked from, `shows`: what the asking screen can draw, `cards` and `pane`) → `AiAnswer` (adds `card`, `context`, `attachment` (the file the question carried), and `choices`, the answers to tap under a question asked before a card; `reads` carry `n`, `module_key`, `params`, `outcome` (`read`, `refused`, `invalid`, `failed` or `timed_out`) and `masked`; a `table` names the `read` it was drawn from) | `praxis_ai` create | no | `Idempotency-Key`; one answer whole, never streamed, with `ai:progress` on the person's realtime room before each read (§6.1.8). The full screen sends `context` and `shows: ["pane"]`. A screen that does not say `shows: ["cards"]` is offered no action, and one without `"pane"` gets no overview spec (§6.11, §6.13) |
| `GET /answers/:id/reads/:n` (`page`) | `PageQuery` → `AiReadRows` | `praxis_ai` view · own | yes, 25 | Read `n` of the answer run again with its stored parameters and the caller's rights now (§6.12): the Table's later pages, the Sources tab and Excel come from here. 404 for a summary or a read that was refused or timed out |
| `POST /answers/:id/reads/:n/export` | `EmptyBody` → `documents.ExportFile`, 202 | `praxis_ai` view · own | | Download Excel (§6.16): every row of read `n`, replayed in the worker with the caller's rights and masks as they stand then, at most 25,000 rows, with an About This File sheet; the screen waits on `GET /exports/:id` and downloads as every export does (`foundation.md` §6.12). 404 as the replay is |
| `GET /cards/:id` | → `AiActionCard` | `praxis_ai` view · own | | The card as the person sees it (§6.11): its fields (`AiCardField`, each with its kind, whether it is `long`, a box of several lines, and `picks`, the picker an id field is chosen with on Edit), its records (what a press acts on) and its `names` (the ids its fields hold, by name), named through the module's own repo, its problems; a status past `shown` is read only |
| `PUT /cards/:id` | `AiActionEdit` (`values`) → `AiActionCard` | `praxis_ai` create · own | | The person's edits, re-validated with the action's schema; problems and names updated; a value for a field the card does not carry is dropped; 409 `CARD_NOT_OPEN` past `shown` |
| `POST /cards/:id/confirm` | `AiActionConfirm` (`values` optional) → `AiActionResult` | `praxis_ai` create · own; the action's own grant inside | | `Idempotency-Key`. 403 `REAUTH_REQUIRED` for a sensitive class without Confirm It's You in the last 5 minutes; 403 `ACTION_FORBIDDEN` when the grant or scope is gone; 409 `CARD_EXPIRED`, `CARD_DONE`, `CARD_RUNNING`, `CARD_CANCELLED`; 422 on the fields; 422 `TOO_MANY_RECORDS` past 25 |
| `POST /cards/:id/cancel` | `EmptyBody` → `AiActionCard` | `praxis_ai` create · own | | The person declines; 409 past `shown` |
| `GET /suggestions` | → `AiSuggestions` (up to 6 questions) | `praxis_ai` view | no | Only questions the person's reads can answer (§6.8) |
| `GET /conversations` (`q`, `sort`, `page`) | `AiConversationListQuery` → `AiConversationPage` | `praxis_ai` view · own always | yes, 25 | Newest first; `q` searches titles |
| `GET /conversations/:id/turns` (`page`) | `AiTurnListQuery` → `AiTurnPage` | `praxis_ai` view · own | yes, 25 | Newest page first; Show Earlier loads the page before |
| `DELETE /conversations/:id` | → `no_content` | `praxis_ai` view · own | | Removes its messages and citations |
| `DELETE /history` | → `no_content` | `praxis_ai` view · own | | Every conversation of the caller |
| `GET /history/summary` | → `AiHistorySummary` | `praxis_ai` view · own; the company's figures with `ai_control` view | no | `view` `company` or `own`; questions this month, your questions, spend this month, the cap (company only), spend per month for six months, questions by module (§6.5) |
| `GET /history/questions` (`q`, `sort`, `page`) | `AiQuestionListQuery` → `AiQuestionPage` | `praxis_ai` view · own always | yes, 25 | Newest first; `q` searches the questions; each with its sources, tokens and cost |
| `POST /history/export` | → `documents.ExportFile`, 202 | `praxis_ai` view · own | | The caller's questions as a workbook, made in the worker (§6.5) |
| `POST /answers/:id/feedback` | `AiFeedback` (`up`, `down` or null) → `no_content` | `praxis_ai` create · own | | |
| `POST /transcribe` | the recording, multipart through the upload engine (`documents.DocumentUpload`, purpose `voice_note`) → `AiTranscript` (the recording's `document_id`, already removed, which the upload engine resolves on; `text`, `draft`) | `praxis_ai` create | | One request: stored, transcribed, removed (§6.6) |

Errors: 404 `NOT_FOUND` (a conversation, answer or card that is not the caller's, or no longer exists,
reads as missing); 422 the contract's; governance's `AI_DISABLED`, `AI_MODULE_DISABLED`,
`AI_CAP_REACHED`; `AI_UNAVAILABLE` (503) when every model is passed by or fails, or the question's
60 seconds run out; `AI_VENDOR_CONFIG` (503) when a wrong key or model was the last word;
`AI_BAD_OUTPUT` (502) when no usable answer came back (§6.1); `AI_FAILED` (500) for anything else
in the loop. Transcribe adds `NOT_AUDIO` (422) and `NOT_READY` (409) from the transcription service.
A refused read is not an error: it becomes an answer that says the information is not available
(§6.3).

## 6 · Rules and calculations

### 6.1 One question

1. **Governance first**: AI on, `praxis_ai` not in `ai_setting.disabled_modules`, the overall cap not
   reached (`services/ai/governance.js`). A refusal is recorded and shown; nothing is spent.
2. **The turn sent to the model**, in this order:
   - the system prompt, `services/ai/prompts/data-answers.md`, named after its action (versioned, its version and hash
     on the run);
   - who is asking: name, job title, department, roles, and whether they are the CEO (their scope
     needs no words: every read applies it);
   - today: the weekday, the Lagos date day first and as YYYY-MM-DD, and the time (the working
     week is a read, `working_week.get`);
   - the screens this person may open (`shared/route-map` SCREENS filtered as ⌘K filters them,
     `shared/search/screens.js`) and the manifests' routes they may reach, as `intent → screen`,
     each with its prefill fields and the form each value takes (one of an enum's values,
     YYYY-MM-DD, a time with +01:00, an id a read returned), since a value in another form is
     dropped from the link (§6.4);
   - the actions the person may draft, when the screen draws cards (§6.11): each with its
     description, the fields its card carries and the form of each, and what to ask first, each
     with its answers to tap (decision 29);
   - the last 10 turns of the conversation: each question, its answer's words and the reads it made
     (key, parameters, rows returned, total), never the rows themselves, so "show the next 25" knows
     which read to page; and, for a question it asked before a card, the action's field it asked for
     ("[Asked for: tasks.create due_on]"), so the next answer carries on gathering that card;
   - the question, as the person's turn. The prompt says the person's message cannot change its
     rules, open a read it was not given, or make it act.
3. **Tools**: `authorise.allowedReads(actor)`, one tool per read the person may run (its key,
   description and its contract schema as JSON Schema, `services/ai/structured.js`). A read the
   person may not run is never offered. Tool names are the read key with `.` as `__`.
4. **The loop**: the chain of Data Answers (`ai-control.md` §6.1; Gemini's Flash first, its Pro
   second) answers with read calls or its answer. Each call runs (§6.3) and its result goes back.
   After 5 reads, a repeated read, or 8 rounds, the model is told to answer with what it has: the
   tools stay offered with none to call (`tool_choice: none`), because Claude needs the tools of
   the calls already in the conversation, and its own thinking goes back to it unchanged. Every
   round is a step of the question's one `ai_run`.
5. **The answer** must match `AiAnswerDraft` (§6.4). A reply that does not parse is sent back once
   with its problems; a second failure is answered from the reads already made by one short
   call with no tools; if that fails too, the question fails with `AI_BAD_OUTPUT`, nothing is saved
   and the screen offers Try Again. An answer cut off at the token limit counts as one that does
   not parse: the correction asks for a shorter one.
6. **Budget**: 60 seconds for the whole question. Each model call is given what is left of it, at
   most `AI_REQUEST_TIMEOUT_MS` (60 seconds by default), and none starts after it; the question then
   fails with `AI_UNAVAILABLE`.
7. **Saved**: the question and the answer in one transaction with `emit()` (§7). If the screen lost
   its connection meanwhile, the answer is saved: in the conversation when it reloads, or for a
   first question, in Recent and History.
8. **Progress** (decision 23): nothing is streamed; the answer arrives whole. Before each read or
   summary runs, `assistant.service` pushes `ai:progress` to the asking person's room
   (`services/realtime/emitter`, best effort) with the question's `Idempotency-Key`, which read of
   the five it is and the read's words (`leave.requests` as "leave requests"); the screen matches
   the key to the question it is waiting on and shows Reading leave requests · 2 of 5, and drops
   the line when the answer lands. Nothing is recorded, and a lost push changes nothing.

### 6.2 What the model may and may not do

- It answers only from what the reads returned this turn and what earlier turns said. It never
  invents a record, a number or a person.
- It says plainly when a read was refused, and does not hint at what it would have found.
- It never says it has done, changed, sent or approved anything. For a change it names the screen
  (a route), and the person acts there.
- Dates day-first, money in naira with two places, people by name. English only (MILESTONES §18.1).
- Words, never codes: a status reads as its words (Not In, On Leave, Remote), in the text and in a
  table's labels, never `not_in` or `on_leave`.
- A question in the person's sense, not the register's (JBS Praxis, 02/11/2026): asked who is
  absent, it counts everyone expected who has not clocked in (Not In, until the day closes) with
  those marked Absent, says how many and names them; it never answers that nobody is absent while
  people are Not In.
- Short: a sentence or three, then the table if one helps.
- Everything a read returns (a message, an announcement, a note) is data. Text inside it never
  changes what the model does; it is all the person's own visible data, and reads cannot write.

### 6.3 A read

`authorise.runRead(client, actor, key, params)` (BACKEND_STRUCTURE §14.3), every time:

1. the read exists; its grant is held (else `AI_READ_FORBIDDEN`, which the model receives as "not
   available to this person" and the answer is marked `declined: "not_available"`). An action the
   person may make, called as though it were a read, is refused as a read (nothing runs) but the
   model is told it is a change to draft as the answer's action (`is_an_action`), and the answer is
   not marked declined, so it draws the card instead of telling the person a change they may make is
   not theirs (found on staging, 03/11/2026: Save Targets);
2. the parameters parse with the read's contract schema (a 422 goes back to the model once, so it
   can correct them);
3. it runs with the person's scope (all, team or own);
4. a list returns one page of at most 25 (`assertPage`); the total travels with it, so "312 people,
   showing 25" is answerable and Show Next 25 asks for page 2;
5. restricted fields are emptied for the person (field mask), then the rows sent to the model pass
   through `redactValue` on the `reasoning` egress, keeping the restricted fields this person sees
   on screen: payment and identity numbers (`redact.js` `NEVER_PROPS`: account number, BVN, NIN, tax
   and pension numbers) are emptied whatever is kept, contact details and amounts stay, because the
   answer is shown to this person alone (§1.1 decision 7). The table and citations are drawn from
   the rows as read;
6. the result sent to the model is the page, its total and the rows, cut at 12,000 characters on a
   row boundary with a note when cut;
7. its citations are kept for the answer (`cite.js`);
8. **it runs inside its own transaction with a statement timeout of 3 seconds** (PR3; decision 14;
   `authorise.guarded`: `SET LOCAL statement_timeout` on a client of its own, under a savepoint when
   the caller's transaction is joined). A read the database cuts answers `AI_READ_TIMEOUT`; a read
   whose service runs on the pool, which no `SET LOCAL` reaches, is held to the same deadline here
   (4 seconds) while the database finishes its statement on its own. The model receives
   `{ error: "too_much" }` with the words "narrow the question" and is told, in the prompt, to ask
   for a shorter period, one department or one person, or a summary; the read is kept as
   `timed_out` (`ai_message_read.outcome`, `AiReadMade.outcome`), so the Sources tab says so, and
   it cannot be paged or exported (404). A summary read runs under the same guard.

### 6.4 The answer

`AiAnswerDraft`, what the model returns: `text` (the words), `table` (`read`: which of this turn's
reads, `fields`: up to 6 of its row's fields, `labels`: their column names) or null, `route` (one
of the offered intents) or null, `prefill` (values for that screen's form, by field) or null,
`more` (a read had a next page worth offering), `action` (a card, §6.11) and `ask` (decisions 28
and 29: the answer is one question, its `text`; up to six short `choices` to tap; the `action` and
`field` it asks for when it asks for one of an action's fields), or null.

The server turns it into `AiAnswer`:

- **table**: the rows of the named read, those fields, formatted for a person (dates through
  `shared/time/day-first`, money through `shared/money`); numeric columns marked for right
  alignment, and each row's link to its record (the read's `cite` of that row, through
  `route-map.linkFor` when shown; null for a row with no screen). A field may reach into a row
  (`employee.display_name`, `department.name`); a field that holds a record (`employee`,
  `department`) reads as that record's name, and a list of names or plain values as one cell,
  comma-separated. A code reads as its words: a code field's value (`status`, `state`, `kind`,
  `type`, `pattern`, `priority` and the like) written in lower case with underscores (`not_in`,
  `on_leave`, `remote`) shows as Not In, On Leave, Remote. **A table names its records** (JBS
  Praxis, 02/11/2026): when none of its columns says who or what each row is, the server puts the
  row's name first (the row's own name, else the record the row is about, labelled with its kind:
  Employee for a register's row), so a list of people always carries their names. A field the read
  did not return is dropped; a table with no valid field is dropped;
- **link**: the route's screen through `route-map.screenPath`, with its `params` and any `prefill`
  values the model gave that parse with the route's `prefill` schema, each field on its own (a
  value a field refuses is left out, the rest kept); the route's own `params` always win. A route
  to a screen the person may not open is never offered and, if named, dropped;
- **citations**: from every read this turn, de-duplicated, first 50 kept with the total;
- **sources**: what From shows (decision 9): one entry per record type the citations name, in the
  order first cited, with its count and its name (`shared/ai/cite.js` `typeLabel`: the type's words,
  "interaction log", or a kinder name where the type's own reads badly, "alert" for `home_alert`).
  When the answer cites exactly one record, the one entry is that record, named and linked;
- **declined**: `not_available` when a read was refused and nothing else answered, `change` when a
  screen was offered (the model offers one for a change asked for, or where no read answers; the
  server cannot tell which), else null;
- **choices**: a question's answers to tap (`askOf`: trimmed, each once, at most six of 60
  characters), kept in the answer's metadata with what it asked for; empty for any other answer.
  When the model asks for one of an offered action's fields (`ask.action` and `ask.field`) and
  gives no choices, they are that field's own from the action's `asks` (Low, Normal, High, Urgent;
  Today, Tomorrow, No Due Day), so a question about a card always has its answers to tap;
- **provisional**: always true.

A change opens its exact form, filled with what the person said. Each route that carries a
`prefill` names a contract schema of the form's own fields (`<Thing>Prefill`), and its `params`
open the form (`new=1`: Workspace reads it itself, My Leave and Employees through `useNewLink`;
the AI read-only gate refuses an `action` key in a manifest). The form reads those fields from the
address as it opens and takes them out of it (`useAddressPrefill`, `app/src/shell/screen-action.tsx`),
so Back and a reload do not fill it again. Nothing is saved until the person presses the form's
own button.

| Intent | Opens | Fills |
|---|---|---|
| create a task | Workspace · Tasks, New Task (`tasks.TaskPrefill`) | Title, notes, priority, cadence, due day; the assignee by name for a manager (the colleague card) |
| book a meeting | Workspace · Calendar, New Event (`calendar.CalendarEventPrefill`) | Title, kind, day, start and end (Lagos time; an hour long when only the start is given), location; the attendees by name (the colleague card), up to 50 |
| start a project | Workspace · Projects, New Project (`projects.ProjectPrefill`) | Name, notes, due day |
| request leave | ESS · My Leave, Request Leave (`leave.LeaveRequestPrefill`) | Leave type, first and last day, note |
| add an employee | People · Employees, Add Employee (`organisation.EmployeePrefill`) | Names, job title, department, start date, employment type, work pattern, contract end |

An address is kept in the browser's history, so a prefill never carries a restricted field. A
manifest whose prefill names one (`shared/rbac/field-mask`: salary, bank, personal, statutory), or a
word the address already uses (`tab`, `id`, `action`, `new`, the route's params), fails when it loads
(`shared/ai/manifest.js`), so the build fails. A schema with nothing restricted is still never the
whole create schema: Add Employee's prefill leaves out the phone and work email too.

### 6.5 Conversations and history

- A question without `ai_conversation_id` opens a conversation titled by its first 120 characters.
- The last 10 turns are replayed; older turns stay on screen but are not sent.
- Delete Conversation and Clear History remove the conversations, messages and citations, and the
  replies the idempotency layer kept for a repeated press of Send (`middleware/idempotency.js`
  `forget`), which hold the answers' words too. The runs stay, holding no words, so spend and the
  cap are untouched.
- `AiHistorySummary` has two views. **Company**, for a person who holds AI Control `view`
  (decision 7 as amended): questions this month are everyone's (the `data-answers` runs that
  answered, so a cleared History does not lower them), your questions are the person's own this
  month, spend is Praxis AI's this Lagos month (its two actions' runs, priced as AI Control prices
  them, `governance.STEP_NGN`), the cap is AI Control's monthly cap for all AI (null when none is
  set), spend per month covers the last six Lagos months, and questions by module counts the
  answers still in anyone's History by the module of their first read. **Own**, for everyone else:
  questions this month and all your questions are the person's, spend and spend per month are their
  own runs, no cap, and questions by module counts their own answers.
- `AiQuestionPage`: the person's questions, newest first, 25 a page. Each row is one answer: the
  question, when it was asked, its sources (the record types its citations name, as From shows
  them), its tokens (in and out, over every round of its run) and its cost in naira. Opening a row
  opens its conversation on Ask.
- Export: the person's questions, newest first, up to 2,500, as an xlsx (Question, Asked, Sources
  Read, Tokens, Cost), reserved in the request and made by the worker (`shared/documents/exports.js`,
  document type `ai_history_export`, personal, kept 24 hours).

### 6.6 Voice

- `VoiceField` (120 seconds at most) records; the screen sends the recording in one request,
  `POST /ai/transcribe`, through the upload engine (purpose `voice_note`).
- The words come from `services/ai/transcription.transcribe` under the action `praxis-ai-voice`
  (Transcription job, personal data, so never DeepSeek; Groq, then Gemini). No browser captions
  are taken: when neither answers, the box stays empty and the microphone says Could not
  transcribe. The stub's placeholder (no provider set up) comes back as a draft and is not put in
  the box either.
- The recording is held in the vault (document type and record type `ai_voice_question`, its id
  the speaker's login) only while it is transcribed, and removed in the same request whatever
  happens. Only the speaker may read it (`vault.defineAccess`), the CEO and an `all` holder
  included. The document type is `transient` (`shared/documents/types.js`), so the vault queues no
  derived file for it, and one a request left behind (the process stopped mid-way) is removed by
  the vault's own sweep (`vault.purgeTransient`, in the hourly `export-cleanup` job) once it is an
  hour old.
- The words land in the box, at most 500 characters; nothing is asked until the person sends it.

### 6.7 The registry, AI Control and jobs

- `data-answers` becomes built.
- New action `praxis-ai-voice` (Transcription, personal data).
- **Any text model IT chooses answers** (`ai-control.md` decision 34). The chain on AI Control stays
  free: a first choice and up to three fallbacks from any connected provider. Each vendor file
  sends tools and returns the model's calls in one shape (`toolCalls`): Gemini already does;
  Anthropic and DeepSeek gain it; Groq and OpenAI gain a text answer with tools, which
  `llm.service` never called them for. No state is added. DeepSeek is still passed by on Data
  Answers because it carries personal data (decision 23).
- `llm.service` gains `converse()`: one round with tools, through the same chain walk, redaction,
  ledger, skips and caps as `complete()`. A model that fails mid-question hands over to the next
  link with the conversation so far, so a fallback carries on where the first choice stopped. The
  assistant's loop calls it; nothing else does.

### 6.8 Suggestions

`GET /ai/suggestions` returns up to 6 example questions, each belonging to a read
(`assistant.suggestions.js`, one line per read key), filtered by the reads the person may run, so a
member of staff is never offered a question about people they cannot see. A read every login may
run that answers only for holders of a capability names it (`team.today` needs `home.team`,
`alerts.mine` needs `alerts.clear`), and its question waits for the capability too; the CEO holds
every one. "What happened today?" (`activity.list`) is offered to everyone.

### 6.9 Reads this build adds

Praxis AI answers what the manifests offer; it does not add reads to other modules on its own.
Where a target question needs a read that does not exist, the read is added in its module (with
that module's guide changed):

- **Home** (built): `activity.list` (`HomeActivityQuery`), Activity Today for any one Lagos day,
  today unless `date` is given, through the Overview's own query, allow-list and scopes (`home.md`
  §6, §9). `employee_id`, or part of a name in `q`, keeps one person's: what they did and what is
  about them. "What happened today?" and "what has Aisha done today?" are one read each.
- **Staff Community** (built): `colleagues.list` (`ColleagueListQuery`), anyone with a login by name,
  with their job title and department, from Staff Community's own directory (`community` view, as
  New Message and New Event list them; the asker listed too, so every reader sees the same people).
  It is how a task's watcher, a meeting's guest or a message's colleague is found for a person
  without the People grant, whose `employees.list` it is not (decision 29: "which one?").
- **My Workspace** (built): `tasks.get` (`IdParams`), one task the asker can see as its panel shows
  it: its steps (each with its id, words, due day and whether it is ticked), what it waits on and
  holds up, its watchers, its open hold and what the asker may do to it, through the panel's own
  service (`workspace.md` §6). "What is left on T-0012?" is one read, and a step is changed by the id
  it returns or by its words (`tasks.edit_step`, §6.11).
- **User Guide** (built): `guide.search` (`PageQuery`), how to do something in the hub: the
  sections and tasks of the guide the asker may read that answer `q`, ranked by the guide's own
  search, a page of 25, each row citing its section (`guide_section`, opening the guide at it)
  (`user-guide.md` §6.8, §9). "How do I request leave?" is answered from the guide, never guessed.

The six target questions of MILESTONES §15 answer as their modules land: overdue tasks (M2,
`tasks.list` today), expenses awaiting approval (M8), due for confirmation (people), inactive
partnerships (M7), candidates awaiting feedback (M4), budget against actual (M8). Due for
confirmation reads `employees.list`, whose rows carry `confirmation_due_on`: MyCity's staff fit on
one page, and People adds a date filter if the staff grows past the 125 people five reads can hold.

### 6.10 Checking answers

`scripts/ai/eval-assistant.js` asks its questions (`CASES`) on staging with a real key, each as the
person of the role it names (the CEO's login, or the active holder of the role code with the most
open tasks, so the questions find their records), through the same engine Ask uses, and grades each
answer. A question names staging's own records as that person holds them: `{person}` is someone in
their reach (their report, else their department), `{<action>#<field>}` the first answer that card's
own question offers them (decision 34; `#2` its second), and the other names (`FILLS`) a record no
question offers (their project, a task with a step to do, an open role, a channel they wrote in, a
month with no round). `given` names records a question needs without naming them (a leave request
waiting on them). A question staging has nothing to fill is skipped, saying what staging lacks,
never failed. A failed card's problems say what was wrong and what the model wrote:

| Grade | Passes when |
|---|---|
| `reads` | one of these reads ran and returned (the answer came from the records) |
| `never` | none of these returned rows (a member of staff asking about others' pay or lateness) |
| `route` | the change asked for came back as this screen, with `declined: change`, never a claim |
| `needs` | a target question whose module declares no read yet is skipped, not failed |
| `action` | the change asked for came back as this card, its values parsing, nothing written |
| `ask` | the change asked for lacks what its action must have, so the answer is the one question for that field, with no card (decisions 28 and 29; the server's asks run as Ask runs them) |
| `picks` | with `action`: a field the card may leave marked Pick one for the person, as a typed address our search does not find exactly once (decision 37) |

The set holds Ifeoma's two ("what happened today", "what has a person done today"), the target
questions as they become answerable, the privacy cases and three changes (a task, leave, a meeting).
It saves nothing to History and writes nothing; each question is one Data Answers run in AI Control
· Spend. `--only=<id prefix>`, `--list` (asks nothing), `--json`. Exit 0 when all pass, 1 when one
fails, 2 when it cannot run (nobody holds a role, AI is off, only the stub answers). Refused on
production. Run by hand before a change to the prompt or the loop ships; not in CI, which has no
key. `tests/unit/foundation/ai-eval.test.js` checks without a key that every question names reads
and screens a manifest declares, that each placeholder is a fill or a card's question with answers
to give, and that the grading passes and fails what it should; `ai-actions-performance` runs the
fills on the real migrations.

### 6.11 Actions and cards (decisions 10, 11, 16, 20, 21; PR1 the lifecycle, PR4 the actions)

A module declares its actions in its manifest beside its reads:

```js
actions: [{
  key: "tasks.create",                       // <thing>.<verb>, unique across modules
  description: "Set a task for me or someone I manage",
  input: c.tasks.TaskCreate,                 // the card's fields: the form's own contract schema
  permission: ["workspace", "create"],       // the grant; the scope comes with it as requirePermission gives it
  // capability: "workspace.late_reasons",   // held on top of the grant, where the screen's route asks requireCapability
  risk: "standard",                          // standard | approval | money | payroll | delete
  bulk: 1,                                   // records one press may touch, at most 25
  records: (values) => [],                   // the records it touches, for the card and the re-check
  check: async (client, values, actor) => {},  // the module's own rules, before run: scope, state, no self-approval
  run: (values, actor, ctx) => service.create(actor, actor.scope, values),   // the same function the screen's button calls
  readback: (result) => [{ type: "task", id: result.task_id, label: result.number, status: "created" }],
  suggest: false,                            // may the model offer it unasked (decision 20)
  fields: ["title", "primary_assignee_id", "watcher_ids", "due_on", "priority"],   // the card carries these alone, in order (decision 31)
  picks: { primary_assignee_id: "task_assignee", watcher_ids: "colleague" },     // what Edit picks an id field with (AiCardPicks)
  names: (values, actor, db) => service.cardNames(db, values),                  // the ids the fields hold, by name; never counted
  asks: [{ field: "due_on", question: "When is it due?", choices: dueChoices, none: true }],   // asked before the card (decision 29)
  // Request Leave's: answers read from the person's own records, and a type the model may write by name (decision 32)
  // asks: [{ field: "leave_type_id", question: "Which leave type?", options: ({ actor, db }) => typeChoices(actor, db) }],
  // resolve: { leave_type_id: (value, actor, db) => typeIdOf(value, db) },
  // A step written by its words is matched within the card's own task (the card's values come fourth):
  // resolve: { task_step_id: (value, actor, db, values) => stepIdOf(db, values.task_id, value) },
  // A place written in words is the one place our search finds, signed; else Pick one (decision 37):
  // picks: { address: "place" }, resolve: { address: (value) => maps.onePlace(value) },
  // The gaps a field's words may hold beside the ready-to-send guard: a letter's own {{ names }}:
  // allows: { body: letterName },
}],
not_offered: { TaskStepCreate: "a step belongs to a task's own panel" },   // every other <Thing>Create of the module, with a reason (gate 23)
```

`defineManifest` checks every key at load: the input and the permission are the contract's and the
catalogue's, a `capability` is one of the catalogue's capabilities, `risk` is one of the five
classes, `run` and `check` are functions, `allows` names carried fields each with a test of its
gaps, and no word that is
a write by another name (`write`, `executor`, `execute`, `mutations`, `sql`, `query`) appears; gate 19
reads the file too and refuses SQL inside it. The engine never sees a repo. `records(values, actor,
db)` may be async and read the records' names through the module's own repo when it is handed the
pool or the press's client, so the card names what it touches ("Ayo Bello, Annual, 3 days"); an id
the person may not see keeps its id alone, and the action's `check` refuses the card. An action
whose input is not the schema its screen's form validates with says `form: "none: <reason>"` (a
button with no form, a form whose record is the panel's own, a composer of its own).

**An edit form's card names its record (decision 33).** A screen's edit form never names the record
it changes, because the panel or page it sits on is that record; a card must. So an edit form's card
takes the form's own schema with the record's id beside its fields (`TaskChange` is `TaskEdit` with
`task_id`; `ProjectChange`, `CalendarEventChange`, `TaskStepChange`), its other rules unchanged, and
says `form: "none: …"`; the form's own schema is then reached `via` that action in `not_offered`. A
card schema is named for its verb (`Change`, `Add`, `Switch`, `WaitOn`), never `Create`, `Edit`,
`Update`, `Patch` or `Save`, so it is no new form (§6.15 rule 6). The card lists only what changes,
with the record named in its first field and as its chip; nothing left out of the values is
cleared. **An action held to a capability** (`capability`), as its screen's route holds it on top of
the grant (`requireCapability`: Late Reasons' `workspace.late_reasons`), is offered only to a person
who holds it, the CEO holding every one, and `authorise.checkAction` refuses it to anyone else, at
the draft and at the press, as the route would. `capabilities`, a list of codes in its place, is
held as `requireAnyCapability` holds it, by any one of them (New Objective's `goals.company` or
`goals.function`). An action's grant is never `view`, unless it names a
capability: a route that asks only `view` and a capability (Home's alert rules, `alerts.manage`;
Home's reports, `home.reports`) is mirrored exactly, the capability being the authority. **A card
that changes part of something saved whole** (a numbering scheme, the working week, the company's
reminders, System Health's targets, a notice's rule) lays what it gives over what is saved and holds
the result to the screen form's own schema before the service saves it (`shared/ai/change.js`), so
the service saves what that form would have sent and a problem comes back on its field. A create
form whose schema never names the record it sits on (Request To Unbind on a plan, Send Wishes on a
celebration card) takes its card the same way as an edit form (`PlanUnbindRequest`, `WishSend`), and
so does a form a card cannot draw as it stands: an audience held as an object (`AnnouncementPost`:
All Staff or Departments), a Copy From that also takes a colleague's scorecard (`ScorecardDraft`), a
form of many lines carried one line at a time (`CheckInLineChange`, `ReviewScoreChange`,
`ScorecardLineAdd`, `ScorecardLineChange`, the run keeping every other line as it stands). A choice
a person reads reads as words, so a card schema's own choices are written as they read
(`all_staff`, All Staff) and the run turns them into the form's own values.

**What a card carries and names (decision 31).** `fields` lists the input's fields the card carries,
in the order it shows them; a value for any other field is dropped before the schema parses it
(`authorise.checkAction`), so a commitment, a repeat or a record pointer never rides on a task card
unseen, and the system turn lists only these. `picks` names, for each id field and list of ids, the
picker Edit chooses it with (`colleague`, anyone with a login; `task_assignee` and `task_member`,
whom the person may set a task for or share one with, as New Task's; `department`; `project`;
`leave_type`, the types Request Leave's form offers; `task`, the tasks the person can see, as Wait
On Task's; `employee`, someone on People's register, as People's forms pick them; `worksite`, a
worksite in use; `policy`, a policy with a version in force, as Raise a Query's; `place`, a place
picked as every address is, with AddressField; `site_member`, the people Add Work Site may put on a
site, the person included; `partner` and `lead`, the partners and leads the person sees, and
`partner_deal`, the open and live deals they see, as Connect to Partner offers them, M7;
`hiring_manager`, who may be a vacancy's hiring manager, as New Vacancy's own picker offers them, M4). A picked field that is not a list reads as an id whatever its type
(`fieldsOf`), so a place's token is read by its line and never printed.
`names(values, actor, db)` names the ids the fields hold through the module's own repo, kept apart
from `records`: the records are what a press acts on (the verb's count, the chips, the re-check), the
names only how an id reads, so a meeting's three guests never make "Create Event ×3". A rule the
schema holds but cannot say to the model (a task is shared with people or a department, never both)
is in the action's description, and the card still shows the schema's own problem on its field.
**A card never shows an id (decision 32):** `authorise.checkAction`, at the draft and at every Save
Changes, marks a field with `picks` whose id, or any id of whose list, neither `names` nor `records`
names with the problem Pick one, in place of the schema's own; the card never prints an id, so the
field reads as its problem alone until Edit picks one. `resolve` takes, for a field the model may write
by name, `(value, actor, db, values) => id`, run before the schema parses the values: a value that is already
an id is left alone, and a name or code is matched among the person's own records (Request Leave's
leave types: by name or code, with or without the word Leave, "Annual Leave" for the type named
Annual, or by the first words only one type's name has; a late reason by its words; a step by its
words among the steps of the card's own task, which `values` carries), else left as written for
Pick one to mark. A week is matched the same way: any day in it, or "this week", "next week" and
"last week", is that week's Monday.
A card whose values have a problem keeps what was matched, so a type matched by name stays matched
while another field is fixed; an id field's value reads only as the name `names` or `records` give
it, never as the words the model wrote.

**A place on a card (decision 37, F27).** A card's place is a `PlaceToken` (`maps.js`): the token our
address search or a pin signed, alone, sent on to the owner's own request as `{ token }`
(`PlaceInput`), so the API still takes only a signed place. The model writes the address in words;
`resolve` asks our search (`maps.service.onePlace`) and signs the one place it finds; several, none,
or the search down leave the words, which name nothing, so the field reads Pick one and Edit picks
it with the screen's own AddressField. `names` reads a token of ours by its line
(`maps.service.cardPlace`); a forged one names nothing. A worksite's centre is its place's point, as
the form fills it from the pick; Add Work Site's card takes one address of the sheet's eight and
never a Temporary Home (a home is personal data). A run sends the form's own request through the
route's own parsing (`shared/http/validate.parseBody`), so a token becomes the place and every
default and rule applies as on the screen.

**Asked before it is drawn (decisions 28, 29 and 34).** `asks` lists what the action must have before
its card is drawn, in order: the field, its one short question (at most 8 words), its answers to tap
(a list, or `({ today }) => list` for answers that move with the day; or `options`,
`({ actor, db, today, values }) => list`, for answers read from the person's own records, such as
their leave types with the days left, which the service fills once the question is chosen,
`answer.withOptions`, the actor carrying the action's scope and `values` what the model drafted)
and whether none is an answer (`none`: null, or an empty list, is then a value the person gave).
Every field the input requires has an ask (decision 34, §6.15 rule 7). `when` names another field:
the question is asked only while that field holds a value (the lead, `primary_assignee_id`, when a
task is shared with a department, `department_id`). `read` names a list read that lists the
person's own records (`tasks.list`, with `params` such as `{ scope: "mine" }`, and `type` to keep
one kind of citation): the answers to tap are its first six rows as their citations read, and a
value written by its words, or tapped, is matched among the rows the same read returns for those
words (its `q`) and then its first page, by the citation's words (`shared/ai/named.js`), so "the
weekly report task" is that task's id; a list of records is matched one by one. The system turn gives the model
each action's asks, and the prompt (version 7) has it ask one at a time, with `ask` naming the action
and field, and never invent a value. The server holds the same list (`answer.askFirst`, the engine's
`cards.nextAsk`): a card the person asked for (never a suggested one) whose model values leave out an
ask's field becomes that question, with its answers and nothing else (no card, table or screen
button), unless the run of questions just before already asked it (then the card is drawn and shows
the gap), and never more than six questions in a row. What a question asked for is kept on its
answer (`metadata.ask`) and replayed, so the guard and the model both see the run.

**One turn for several fields (`also`; TB, 13/11/2026).** An ask may name, in `also`, one to three
other fields the same turn asks for; its question is then one short question a field, at most 8
words each ("What are you paying for? How many? How much is each?", New Request's item, quantity and
unit price), the model reads each from the one answer, and the turn stands in the run for its own
field. A field of `also` may keep an ask of its own, asked only when the answer left it out (Unit
Price's "How much is each?").

**The model's numbers in the contract's forms (TB, 13/11/2026; every card).** A model writes 700000
and 1 where the contract takes the text "700000.00" and "1" (money is a two-place string, gate 20;
a quantity is sent as text), and a card was refused "Expected string, received number" on a value
the person gave right. `authorise.checkAction`, at the draft, at Save Changes and at the press,
first puts each value in the form its field's JSON Schema takes (the engine's `cards.shape`): a
number where text of figures is taken is that text; an amount with ₦, commas or fewer than two
places, written or as a number, is the two-place string ("₦700,000" and 700000 are "700000.00"); a
number written as text where a number is taken is the number; "true" and "false" where a boolean
is. Anything else, three places or words, is left for the schema to refuse on its field. The system
turn names the form too (an amount as text with two places; a number as text). On the card a field
of figures sent as text (a quantity, an account number) is a one-line number field (`kind`
`number`), and Edit checks and saves an amount as typed through `toMoneyString`, as every money form
reads it.

**What a done press offers next (`then`; TB, 13/11/2026).** An action may give `then(result,
values)`, the steps a person most often takes next, at most three `{ label, question }`; they are
kept with the run (`ai_action_run.result`) and returned as `AiActionResult.next`. Under the result
line the card shows each as a button (the first primary); pressing it asks its question in the
conversation, so the next card is drawn, checked and confirmed as any other, never pressed by the
button. New Request kept as a draft and Add Line offer Add Another Item and Send Request; a request
sent at once offers nothing (`expenses.md` §9). A `then` that throws offers nothing and the press
stands.

**The actions (PR4).** Each runs the same service function the screen's own button calls, with
the person's rights as the grant gives them; a bulk action runs its records one after another,
each in the service's own transaction, and reads back a line per record (done, or why not), so one
request decided meanwhile never stops the rest; nothing done at all is a refusal and the card stays
open with the reason.

| Action | Module, grant, risk | Input (the card's fields) | Records named | At the press | Runs |
|---|---|---|---|---|---|
| `tasks.create` | `workspace` create, standard, may be suggested | `TaskCreate` (New Task's form): the title, notes, whom it is for, the people or department sharing it, its watchers (people or a department), due day, priority, cadence, project; asks the title, the due day (Today, Tomorrow, Friday, No Due Day) and the priority (Low, Normal, High, Urgent) | none: it makes one task; whom it is for, the people sharing and watching it, the departments and the project are named (`tasks.service.cardNames`) | the scope, and New Task's own rules on whom and with whom (`workspace.md` §6) | `tasks.service.create` |
| `tasks.complete` | `workspace` edit, standard, up to 25 | `TaskComplete`: the tasks, a late reason | the tasks, by number and title | every task on the person's board; a cancelled or waiting one is its own line | `move()` to Done, one after another |
| `tasks.comment` | `workspace` edit, standard | `TaskCommentAdd`: the task (filled from the screen asked from), the words | the task | on the person's board | `tasks.service.comment` |
| `tasks.edit` (Save Task) | `workspace` edit, standard | `TaskChange` (Edit Task's `TaskEdit` with the task): the title, notes, due day, priority, cadence, whom it is for, the people or department sharing it, the project; only what changes | the task, by number and title; the people, department and project named | on the person's board; the setter's fields need the right to manage it, the notes and priority the people on it (`workspace.md` §6) | `tasks.service.edit` |
| `tasks.add_step` (Add Step) | `workspace` edit, standard | `TaskStepAdd` (Add Step's `TaskStepCreate` with the task): the step, its due day; asks the step ("What is the step?") | the task | on the person's board; its lead or setter (the panel's own rule) | `tasks.service.addStep` |
| `tasks.edit_step` (Save Step) | `workspace` edit, standard | `TaskStepChange` (`TaskStepEdit` with the task and the step, the step matched by its words): ticked or not, its words, its due day | the task; the step named | ticking for anyone who sees the task, its words and day for its lead or setter | `tasks.service.editStep` |
| `tasks.wait_on` (Add Link) | `workspace` edit, standard | `TaskWaitOn` (Wait On Task's `TaskDependencyCreate` with the task): the task it waits on, picked with Wait On Task's own list | the task; the one it waits on named | both on the person's board; never itself, never a loop | `tasks.service.addWaiting` |
| `late_reasons.add` (Add Reason) | `workspace` edit and the `workspace.late_reasons` capability, standard | `LateReasonCreate` (Late Reasons' form): the reason's words | none: it makes one reason | a holder of the capability; the words new, 25 at most | `tasks.reasons.add` |
| `late_reasons.switch` (Switch Reason) | `workspace` edit and the `workspace.late_reasons` capability, standard | `LateReasonSwitch` (Late Reasons' toggle, `LateReasonEdit` with the reason, matched by its words): on or off | the reason, by its words | a holder of the capability | `tasks.reasons.setActive` |
| `projects.create` (Create Project) | `workspace` create, standard | `ProjectCreate` (New Project's form): the name, notes, due day; asks the name ("What is the project called?") | none: it makes one project, the person's own | an employee | `projects.service.create` |
| `projects.edit` (Save Project) | `workspace` edit, standard | `ProjectChange` (Edit Project's `ProjectEdit` with the project): the name, notes, due day, and Completed or Active (Complete Project, Reopen Project); only what changes | the project, by number and name | its owner, or a grant that reaches everyone | `projects.service.edit` |
| `calendar.create` | `workspace` create, standard | `CalendarEventCreate` (joined from New Event's day and times); asks what it is about, when, how long (30 Minutes, 1 Hour, 2 Hours) and who comes (Just Me) | none: it makes one event; the attendees are named | someone not on the staff refused on the field | `calendar.service.create` |
| `calendar.edit` (Save Event) | `workspace` edit, standard | `CalendarEventChange` (Edit Event's `CalendarEventEdit` with the event, its day and times joined as New Event's are): the title, start and end, attendees, kind, location, visibility, notes, reminders; only what changes | the event, by its title; the attendees named | the person made it, and it is not called off; someone not on the staff refused on the field | `calendar.service.edit` |
| `week.support` (Save Support Needed) | `workspace` edit (the screen's route asks `workspace` view; an action's grant is never view), standard | `WeekSave` (Write Support Needed's form): the week (any day in it, or this, next or last week, as its Monday) and the line; Tidy With AI's summary stays on the screen; asks the line ("What support do you need?") | none: the person's own week | an employee | `workspace.service.save` |
| `organisation.edit` (Save Organisation) | `settings` edit, standard | `OrganisationPatch` (Organisation's form): the legal and trading names, registration number, tax id, phone, email, website; never the address, picked on the map (F27) | none | Settings' own rules | `settings.service.updateOrganisation` |
| `holidays.add` (Add Holiday), `holidays.edit` (Save Holiday) | `settings` create, edit, standard | `HolidaySave` (Add Holiday's form); `HolidayChange`: the holiday (from `holidays.list`, by its name), its day or name, the rest kept | the holiday, by name and day | no two on one day | `addHoliday`, `updateHoliday` |
| `working_week.day` (Save Working Day) | `settings` edit, standard | `WorkingDayChange`: the day by name, worked or not, its hours; the other six kept, then held to `WorkingWeekSave` | none | at least one day worked, ends after it starts | `settings.service.saveWeek` |
| `numbering.edit` (Save Numbering) | `settings` edit, standard | `NumberingSchemeChange`: the document (from `numbering.list`, by its name), its prefix, digits, separator, restart, period; the rest kept, then held to `NumberingSchemeSave` | none | the scheme's own rules | `settings.service.saveScheme` |
| `notices.preference` (Save Notice Setting), `notices.quiet_hours` (Save Quiet Hours), `notices.digest` (Save Digest) | `ess` edit (the person's own, as the bell's Settings), standard | `NotificationPreferenceUpdate` (a kind by its name, a channel, on or off); `QuietHoursChange` (the rest kept, held to `QuietHoursUpdate`); `DigestUpdate` | none | a locked kind stays on | `setPreference`, `setQuietHours`, `setDigest` |
| `notice_rules.edit` (Save Notice Rule), `notice_reminders.edit` (Save Reminders) | `settings` edit, standard | `NotificationRuleChange` (the notice by its name, what changes, the rest kept); `NotificationRemindersChange` (each setting by its own name, the rest kept) | the notice | a security notice stays on; a notice for one person takes no copies | `notifications.rules.save`, `saveReminders` |
| `health_targets.edit` (Save Targets), `faults.edit` (Save Fault), `faults.note` (Add Note) | `system_health` edit, standard | `PerformanceTargetsChange` (the rest kept, held to `PerformanceTargetsUpdate`); `FaultChange` (the fault by its title, its status and a note; who holds it stays on the fault's sheet); `FaultNoteAdd` | the fault, by its title | the levels in order | `targets.save`, `patch`, `addNote` |
| `alert_rules.create` (Create Alert Rule), `alert_rules.edit` (Save Alert Rule) | `home` view and the `alerts.manage` capability, standard | `HomeAlertRuleCreate` (asks the name, the metric, the number, the severity, and who clears it, "Its Own Default" being the metric's); `HomeAlertRuleChange` (the rule by its name, what changes) | the rule | the metric's own rules | `alerts.service.createRule`, `updateRule` |
| `reports.create` (Create Report), `reports.edit` (Save Report), `reports.schedule` (Schedule Report) | `home` view and the `home.reports` capability, standard | `HomeReportCreate` (its name, type and sharing; filters stay on the report's form); `HomeReportChange` (the report from `reports.mine`, by its name); `HomeReportScheduleChange` (how often, the days, the time, the formats, who receives it, "Just Me" or by name), held to `HomeReportScheduleSave` | the people receiving it named | recipients who may receive it | `reports.service.create`, `update` |
| `my_leave.request` | `ess` create, standard | `LeaveRequestCreate` (Request Leave's form): the leave type (named, picked with Request Leave's own list, matched by name when the model writes one), the first and last day, the note; asks which type ("Which leave type?") with the person's types and the days left of each | none: the person's own | an employee; the type, the days and the year's allowance are the service's | `leave.service.request` |
| `leave.approve`, `leave.reject` | `people` approve, **approval**, up to 25 | `LeaveApprove`, `LeaveReject` (a reason, required to reject) | the requests: who, the type, the days | every request in the person's `people` scope; then each waiting and named on its stage, never their own, as a line | the approval's own `decide()` per request |
| `leave.record` (Record Leave) | `people` create, **approval** (approved at once, it spends the person's year: decision 39) | `LeaveRecordCreate` (Record Leave's own request): the person (picked from People's register), the leave type (by name, Request Leave's list), the first and last day, a note; asks who (People's register, `read`), the type and the days | none; the person and the type named | the person in the reader's `people` scope, at work now | `leave.service.record` |
| `leave_types.add` (Add Type) | `people` create, standard | `LeaveTypeAdd` (New Leave Type's sheet): the name and the working days a year; the code made from the name on the server, as the sheet makes it; asks the name | none: it makes one type | at most 25 offered at once, the code new (the service's) | `leave.service.addType` (`createType`) |
| `leave_types.edit` (Save Type) | `people` edit, **approval** (an allowance moves everyone's year: decision 39) | `LeaveTypeChange` (Edit Leave Type's `LeaveTypeUpdate` with the type, matched by its name): the name, the days a year, offered or retired; only what changes; asks which type, the types to tap | the type, by its name | the type exists | `leave.service.updateType` |
| `overtime.approve` (Approve Overtime) | `people` approve, **approval** (it decides pay: decision 39) | `OvertimePreApprovalCreate` (Approve Overtime's sheet, which never names its person): the person (People's register), the day, the minutes, why; asks whose (People's register in reach, `read`), the day, the minutes and why | the person, by name, when in the reader's reach (else Pick one) | someone in the reader's `people` scope, at work now, never themselves; the day from today to 90 days ahead (the service's) | `attendance.pay.approveOvertime` |
| `temporary_sites.add` (Add Work Site) | `ess` create, standard | `TemporarySiteAdd` (Add Work Site's sheet with one address): the purpose (never a Temporary Home), a name, what the work is, the first and last day, the hours, the address (a place, decision 37) with its label and radius, who goes (the person included); asks the purpose, a name, the address, the days, who goes and the work | none: it makes one site for approval; the place and the people named | the sheet's own checks: the days, everyone at work, one site a day | `attendance.sites.submit` with `TemporarySiteCreate` |
| `employees.add` (Add Employee) | `people` create, standard | `EmployeeAdd` with the work record alone (decision 36): names, work email and phone, job, department, line manager, worksite, start date, engagement, work pattern, contract end, confirmation due; asks every field the record needs | none: it makes one record; the department, worksite and line manager named | no field the reader's role hides (field-mask); On Site and Hybrid name a worksite (the form's own rule) | `organisation.service.createEmployee`, in its own transaction (`organisation.cards.addEmployee`) |
| `employees.edit` (Save Record) | `people` edit, standard | `EmployeeChange` (Edit Record's `EmployeeUpdate`, its work record alone, with the person): names, work contact, job, department, worksite, engagement, pattern and the engagement's dates; only what changes; asks whose (`read`) | the person, by name | the record in the reader's `people` scope (else 404), as Edit Record opens it | `organisation.service.updateEmployee`, a new department moving the person as People · Departments does |
| `employees.reporting` (Save Line) | `people` edit, standard | `EmployeeReportingChange` (Reporting Line's `EmployeeReportingUpdate` with the person): the line manager and the dotted line, each a person (null clears one; a vacant seat is picked on the Organogram), the reason; asks whose (`read`) | the person; the managers named | the record in scope; never themselves, never a loop (the service's) | `organisation.service.setReportingLine` |
| `departments.create` (Add Department) | `people` create, standard | `DepartmentCreate` (Add Department's request): the name, a code of 2 to 10 letters, what it does, its head (a person); asks the name | none: it makes one department; the head named | the `people` grant over everyone, as the route's controller asks | `organisation.service.createDepartment` |
| `departments.edit` (Save Department) | `people` edit, standard | `DepartmentChange` (Edit Department, Set Head, Retire and Restore with the department, matched by its name): the name, code, description, head (a person), in use or retired; only what changes; asks which (`read`, `departments.list`) | the department, by its name | the grant over everyone; the department exists; retired only once empty (the service's) | `organisation.service.updateDepartment` |
| `seats.create` (Add Role) | `people` create, standard | `OrgSeatCreate` (Add Open Role's request): the title, department, the person it reports to; asks the title and the department | none: it makes one open role; the department and manager named | the department exists (the service's) | `organisation.service.createSeat` |
| `seats.edit` (Save Role) | `people` edit, standard | `OrgSeatChange` (Edit Open Role with the role, matched by its title): the title, department, the person it reports to, closed; only what changes; asks which open role (`read`, `seats.list`) | the role, by its title and department | the role exists; a filled one changes with its person (the service's) | `organisation.service.updateSeat` |
| `worksites.create` (Add Worksite) | `people` create, standard | `WorksiteAdd` (Add Worksite's form with its place picked, decision 37): the name, the address, the radius, the time zone; the centre is the place's point; asks the name, the address and the radius | none: it makes one worksite; the place named by its line | the time zone one the server knows (the service's) | `worksites.service.create` with `WorksiteCreate` |
| `worksites.edit` (Save Worksite) | `people` edit, standard | `WorksiteChange` (Edit Worksite with the worksite, matched by its name): the name, a new address (its point the new centre), radius, time zone, in use or retired; only what changes; asks which worksite (`read`) | the worksite, by its name; the place named | the worksite exists | `worksites.service.update` with `WorksiteUpdate` |
| `approvals.decide` | `ess` create (the queue is the person's own), **approval**, up to 25 | `ApprovalDecide`: the requests, approve, reject or request changes, a reason (required but to approve) | the requests: the flow and who it is about | every request the person may read; then each pending, the stage naming them, `approve` held on its module, never their own; one decided on its record refused with that record's screen on its line | `workflow.service.decide` per request |
| `quarters.create` (Set Up Quarter) | `performance` create and `performance.manage`, standard | `PeriodCreate` (Set Up Quarter's form): the first day, the name, Planning or Active; the scoring rules are the last quarter's, changed on Goals | none: it makes one quarter | a holder of the capability; a quarter's first day, never one set up already | `goals.service.createPeriod` |
| `quarters.edit` (Save Quarter) | `performance` edit and `performance.manage`, standard | `PeriodChange` (Edit Quarter's `PeriodEdit` with the quarter, by its name, or this, next or last quarter): the name, the status; only what changes | the quarter, by its name | not closed; the status moves forward only | `goals.service.updatePeriod` |
| `goals.create` (Record Goal) | `performance` create and `goals.organisation`, standard | `OrganisationalGoalCreate` (New Goal's form): the goal, strategic theme, success measure, baseline, plan year (a year, or this or next year, as its 1 January); asks the goal ("What is the goal?") | none: it makes one goal, its ID given | a holder of the capability | `goals.service.createGoal` |
| `goals.edit` (Save Goal) | `performance` edit and `goals.organisation`, standard | `OrganisationalGoalChange` (Edit Goal's `OrganisationalGoalEdit` with the goal, by its ID or its words): the goal, its description, one quarter's target in words; only what changes | the goal, by ID and title; the quarter named | the goal exists | `goals.service.updateGoal`, the other quarters' targets kept |
| `goals.share` (Share Goal) | `performance` edit and `goals.organisation`, standard | `GoalShareChange` (Share Goal's `GoalShareSave` with the goal): All Staff or Chosen Departments, the departments | the goal; the departments named | the goal exists | `goals.share.saveGoal` |
| `objectives.share` (Share Objective) | `performance` edit and `goals.company`, standard | `ObjectiveShareChange` (Share Objective's `GoalShareSave` with the objective, by its code or words) | the objective, by code and title; the departments named | a company objective | `goals.share.saveObjective` |
| `objectives.create` (Set Objective) | `performance` create and `goals.company` or `goals.function`, standard | `ObjectiveCreate` (New Objective's form): the quarter, the function (none for the company's), the objective, the organisational goal it serves; asks the objective | none: it makes one; the quarter, the function and the goal named | whoever sets that function's goals, its plan open (the module's own rule) | `goals.okrs.createObjective` |
| `objectives.edit` (Save Objective) | `performance` edit and `goals.company` or `goals.function`, standard | `ObjectiveChange` (Edit Objective's `ObjectiveEdit` with the objective, by its code or words): the objective, the goal it serves | the objective; the goal named | whoever sets its function's goals, its plan open | `goals.okrs.updateObjective` |
| `key_results.create` (Set Key Result) | `performance` create and `goals.company` or `goals.function`, standard | `KeyResultCreate` (New Key Result's form): the objective (by its code), the key result, measure, target, unit, target in words, start, finish, type, owner, co-owner, direction, baseline, owner note; Feeds and Scored From stay on the form; asks the key result | none: it makes one; the objective and the owners named | as Set Objective; at most four to an objective | `goals.okrs.createKeyResult` |
| `key_results.edit` (Save Key Result) | `performance` edit, standard (the route names no capability; the service's rule holds) | `KeyResultChange` (Edit Key Result's `KeyResultEdit` with the key result, by its code): as Set Key Result; only what changes | the key result, by code and words; the owners named | whoever sets its function's goals, its plan editable (a binding one changes by Change Target) | `goals.okrs.updateKeyResult` |
| `plans.unbind` (Request To Unbind) | `performance` create and `goals.company` or `goals.function`, standard | `PlanUnbindRequest` (Request To Unbind's `PlanUnbindCreate` with the plan, by its function or the company, this quarter's): the reason; asks why ("Why should it be unbound?") | the plan: its function and quarter | binding, the quarter open, whoever sets its goals, no request waiting | `goals.service.requestUnbind` |
| `target_changes.request` (Change Target) | `performance` edit, standard | `TargetChangeCreate` (Change Target's form): a key result (by its code) or a scorecard line (by its words, on the scorecards the person reviews or heads), the new target and its words, the month it applies from, the reason; asks the reason | the key result or the line | requestChange's own rules: a live plan or binding scorecard, its owner, head or reviewer (never one's own line), nothing waiting | `goals.service.requestChange` |
| `kpis.create` (Set KPI) | `performance` create and `goals.function`, standard | `KpiCreate` (New KPI's form): the function, the KPI, formula, unit, direction, target wording and figure, frequency, data source, first quarter; asks the KPI ("What is the KPI called?") | none: it makes one; the function and the quarter named | the function's head (or `performance.manage`) | `kpis.service.create` |
| `kpis.edit` (Save KPI) | `performance` edit and `goals.function`, standard | `KpiChange` (Edit KPI's `KpiEdit` with the KPI, by its code or name): the KPI, formula, unit, target wording, data source; only what changes | the KPI, by code and name | the function's head | `kpis.service.update` |
| `rounds.open` (Open Round) | `performance` create and `performance.manage`, standard | `RoundCreate` (Open Round's form): the quarter, the month (by its name or any day in it) | none: it opens one round; the quarter named | an active quarter's month that has ended, no round yet | `reviews.cycle.createRound` |
| `reviews.score` (Save Score) | `performance` edit (the route asks `performance` view), **approval** | `ReviewScoreChange` (one line of Score Review's `ReviewScoresSave`, with the review, by its person, and the line, by its words): the final score, the reason it differs, the comment, a corrective action with its owner and due day; only what changes | the review: its person and month; the line and the owner named | its reviewer, the check-in in and the review with them; the other lines and their actions kept | `reviews.service.saveScores` |
| `check_ins.save` (Save Check-In) | `ess` create, standard | `CheckInLineChange` (one line of My Performance's `ReviewCheckInSave`, by its words): the actual, the day delivered, the action, my score and its reason, a link, a source or a task as evidence; only what changes | my check-in: its month; the line named | my open check-in, not sent; a file and Submit Check-In stay on My Performance | `reviews.service.saveCheckIn`, that line alone |
| `pips.start` (Start PIP) | `performance` create and `performance.manage`, **approval** | `PipStart` (Start PIP's form with the review, by its person): the start, end and review days, the summary, the lines as words (left out, the lines scored under target, as Start PIP fills them) | the review: its person and month | a closed review rated Below in scope, never one's own, no plan open | `reviews.pip.create` |
| `pips.edit` (Save PIP) | `performance` edit and `performance.manage`, **approval** | `PipChange` (`PipEdit` with the plan, by its person): the end and review days, the summary, the lines (they replace the plan's; a line kept by its words keeps its target); only what changes | the plan: its person | open or extended, in scope | `reviews.pip.edit` |
| `scorecards.create` (Draft Scorecard) | `performance` create, standard | `ScorecardDraft` (New Scorecard's `ScorecardCreate`: the person, the quarter, Copy From Last Quarter or None; a colleague's scorecard to copy stays on the form) | none: it makes one; the person and the quarter named | a person in scope, never one's own | `targets.service.create` |
| `scorecards.add_line` (Add Line) | `performance` edit, standard | `ScorecardLineAdd` (a new line of Edit Lines, with the scorecard, by its person): the section, goal, measure, target, due day, weight, key result (by its code) or KPI (by its code); asks the goal ("What is the goal?") | the scorecard: its person and quarter; the key result or KPI named | a draft the person may edit, never their own | `targets.service.saveLines`, every other line as it stands |
| `scorecards.edit_line` (Save Line) | `performance` edit, standard | `ScorecardLineChange` (a line of Edit Lines, by its words): only what changes | the scorecard; the line, key result and KPI named | as Add Line | `targets.service.saveLines`, every other line as it stands |
| `scorecards.edit` (Change Reviewer) | `performance` edit, standard | `ScorecardChange` (Change Reviewer's `ScorecardEdit` with the scorecard, by its person): the reviewer, the reason | the scorecard; the reviewer named | `performance.manage` (the service's rule); nobody reviews themself | `targets.service.update` |
| `community.message` | `community` create, standard, may be suggested | `DirectMessageSend`: the colleague, the words | the colleague, by name | on the staff with a login | the conversation opened if there is none, then `postMessage` |
| `community.post` | `community` create, standard | `ChannelPost`: the channel, the words | the channel, by name | a member who may post there (never #announcements) | `postMessage` |
| `announcements.publish` (Publish Announcement) | `community` create and `announcements.post`, standard (one press, as the screen's) | `AnnouncementPost` (New Announcement's `AnnouncementCreate`, its audience as All Staff or Departments): the headline, the message, the audience and its departments, the urgency, when it goes out (left out, now); asks the headline and the message | none: it publishes or schedules one; the departments named | a holder of the capability; a time ahead | `announcements.service.create` |
| `announcements.edit` (Save Announcement) | `community` create and `announcements.post`, standard | `AnnouncementChange` (Edit Announcement's `AnnouncementUpdate` with the announcement, by its headline): only what changes | the announcement, by its headline | scheduled and not gone out; a time ahead | `announcements.service.update`, the rest as it stands |
| `channels.create` (Create Channel) | `community` create, standard | `ChannelCreate` (New Channel's form): the name, purpose, who can post, the people and departments | none: it makes one; the people and departments named | a name no channel has | `community.service.createChannel`, then the purpose posted in it as New Channel posts it |
| `channels.edit` (Save Channel) | `community` create, standard | `ChannelChange` (Edit Channel's `ChannelUpdate` with the channel, by its name): the name, the purpose; only what changes | the channel | its admin; never #general or #announcements | `community.service.updateChannel` |
| `community.recognise` (Post Recognition) | `community` create, standard | `RecognitionCreate` (Recognise's form): the colleague, the note (left blank, a thank you note is written) | none: it posts one in #general; the colleague named | a colleague, never oneself | `community.service.recognise` |
| `community.wish` (Send Wishes) | `community` create, standard | `WishSend` (Send Wishes' `WishCreate` with the card, by whose birthday or anniversary it is) | the card: whose and which | a live card in a channel the person is in | `community.service.sendWish` |
| `community.edit_message` (Save Message) | `community` create, standard | `MessageChange` (Edit Message's `MessageEdit` with the message: the person's newest still to be changed in the channel or conversation named): the words, a poll's options | the message, by where it is, never its words | its author; a text within 15 minutes, a poll before its first vote | `community.service.editMessage` |
| `mail.send` | `mailbox` create, standard | `MailCompose`: to, cc, subject, the words as plain text | none | the person's mailbox connected (else `NO_MAILBOX`, and the screen offers Mailbox) | a new draft saved and queued as Send does, the signature baked (`sendNew`) |
| `signatures.save` (Save My Signature) | `mailbox` edit, standard | `MySignatureSave` (Edit Numbers and the tab's switches): the mobile (the employee record's, changed as the tab changes it), the office line, Show Mobile, Show WhatsApp | none: the person's own | an employee record | `signature.service.saveMine` |
| `signatures.configure` (Configure Signature) | `mailbox` edit (the route asks `mailbox` view) and `mailbox.signature`, standard | `SignatureConfigChange` (Configure's `SignatureConfigSave`, only what changes): the app and social links, the confidentiality note, WhatsApp Links, App Links, Social Links, Legal Line | none: the company's | a holder of the capability | `signature.service.saveConfig`, the rest as it stands |
| `queries.raise` (Raise Query) | `queries` create, **approval** (it starts due process and sends a signed letter: decision 39) | `QueryRaise` (Raise a Query's form without its pad and letter choice): the person (People's register), the subject, what happened, the policy it breaches (a policy in force, by its title) and the clause; asks who (People's register, `read`), the subject and what happened | none: it makes one query; the person and policy named | someone at work now, never the raiser; a saved signature (else 409 `NO_SIGNATURE`: Praxis AI cannot draw one, and Draw Signature opens Edit Signature, decision 38) | `queries.service.raise` with `QueryCreate`, signed with My Signature (`queries.signature.signatureOf`) |
| `my_queries.respond` (Send Response) | `ess` create, standard | `QueryRespond` (My Queries' response with its query, matched by its number or subject among the person's own open ones): the words as plain text, 20 to 4,000 characters, sent as the editor's HTML; asks which of their own open queries (to tap) and the response | the query, by number and subject | the person's own query, still waiting for its one response | `ess.queries.respond` (`queries.response.respond`) |
| `query_rules.create` (Save Rule, New Rule) | `queries` create and `queries.configure`, standard | `QueryRuleCreate` (New Rule's request): the name, what it counts, the threshold and days, the letter (an active query letter, by its name), the policy and clause; asks the name, what it counts, the threshold and the days | none: it makes one draft rule; the policy named | a holder of the capability; the letter and policy as the service checks them | `query_rules.service.create` |
| `query_rules.edit` (Save Rule, Edit Rule) | `queries` edit and `queries.configure`, standard | `QueryRuleChange` (Edit Rule's `QueryRuleUpdate` with the rule, matched by its name or code); only what changes; asks which rule, the rules to tap | the rule, by its name | a holder; the trigger fixed once it has fired (409 `RULE_HAS_FIRED`) | `query_rules.service.update` |
| `chain.add_step` (Add Step) | `queries` create and `queries.configure`, standard | `ConsequenceStepCreate` (Add Step's request): the name, position, letter (an active sanction letter, by its name), financial effect, days, how long in force, evidence required; asks the name | none: it makes one step | a holder of the capability | `sanctions.chain.create` |
| `chain.edit_step` (Save Step) | `queries` edit and `queries.configure`, standard | `ConsequenceStepChange` (a step's Move Up, Move Down, Retire and Restore, and its words, with the step matched by its name); only what changes; asks which step, the ladder to tap | the step, by its name | a holder; the step exists | `sanctions.chain.update` |
| `letters.create` (Add Letter) | `queries` create and `queries.configure`, standard | `LetterTemplateCreate` (New Template's request): the name, what it is used for, a title, the wording as Markdown with the letter's own {{ names }} (`allows`), a draft or active; asks the name, the use and the wording | none: it makes one letter | a holder of the capability | `templates.service.create` |
| `letters.edit` (Save Letter) | `queries` edit and `queries.configure`, standard | `LetterTemplateChange` (Edit Template's Save Letter with the letter, matched by its name or key): the name, what it is used for, a title and new wording, saved as the next version; only what changes; asks which letter, the letters to tap | the letter, by its name | a holder; not retired; the use kept while something sends it (the service's) | `templates.service.saveLetter` (`update`, then `saveBody`, as Save Letter does) |
| `policies.start` (Start Policy) | `knowledge` create and `policies.manage`, standard | `PolicyStart` (New Policy's own form, which validates with it): the title; started for everyone, acknowledged within 7 days, no approval (`POLICY_START`, the sheet's own); asks the title | none: it makes one written policy | a holder of the capability | `policies.service.start` (`create`) |
| `policies.draft` (Save Draft) | `knowledge` edit and `policies.manage`, standard | `PolicyDraftChange` (Save Draft's `PolicyDraftSave` with the policy, matched by its number or title): the title, who it applies to (everyone, departments, work patterns, people), acknowledgement, approval, a written policy's text as Markdown; only what changes, the rest kept from the draft, else from the newest version; asks which policy (`read`) | the policy, by number and title; departments and people named | a holder; the policy exists and is not archived; not while a version waits for approval (409, the service's) | `policies.service.changeDraft` (`saveDraft`) |

Performance's forms are all in the chat (decision 40): the monthly check-in a line at a time
(`check_ins.save`), as the person fills it on My Performance, and a review's scores a line at a time
(`reviews.score`), each saving that line alone through the screen's own save and keeping every other
as it stands. A record a card names by its words is matched among the person's own (a quarter by its
name, or this, next or last quarter; a goal, an objective, a key result or a KPI by its code or its
words; a review, a plan, a scorecard or an improvement plan by its person; a line by its words among
its own scorecard's or review's), as decision 32 matches a leave type. Each asks for what it needs
first when it was not said (decision 34), the person's own records to tap: which quarter (those not
closed), goal, objective (this quarter's, of a plan still open to change), KPI (of the
functions the person sets), key result (of a plan still open to change, for Save Key Result; a
binding one's target changes through Change Target), plan (this quarter's binding ones), review (those waiting on them as
reviewer; for Start PIP, the closed ones rated Below), line, scorecard (by person and quarter; the
drafts they may change for a line), improvement plan or colleague; Set KPI which function and its
target, Add Line its section, measure (the ones that section takes) and weight, Share Goal and Share
Objective who sees it and, only for chosen departments, which; Change Target and Open Round the
month, Start PIP its first day, Save Score a corrective action's words and due day once it has an
owner or words, Change Reviewer who and why. Staff Community's ask the same way: which channel (the
channels the person runs), whose card (the last two weeks') and the wish, where a message is (their
channels) and which (their newest message or poll) and its new words, whom to recognise (the
directory), which announcement (those still waiting) and, for chosen departments, which. An answer
naming a record is at most 60 characters, cut at a word (`named.choiceWords`), and the matcher
reads it back. A figure is read as the number in the words the person used (`named.quantityOf`:
"95%", "40 stories" and "64,000 users" are 95, 40 and 64000; words holding none or two stay as
written, marked): a KPI's target, a key result's, a line's target and weight, a target change's new
target and a check-in's actual. Praxis AI still reads no
mail, no message and none of a check-in's actions, a review's comments or a plan (decision 19,
`performance.md` §8): what a card carries is the person's own words and the records the reads
returned.

**Held to ready to send.** At the draft, at an edit and at the press, every text a card carries
goes through the same guard as the mailbox's Write With AI (`services/ai/drafts.js`
`placeholdersIn`): a gap left to fill (a bracket, "insert here", XXX, a blank line) or a redaction
token that stands for nothing is a problem on its field ("Fill the gap"), so a mail or a message
never leaves with a hole in it. A picked field is no text (an id, a place's token), and a field's
`allows` passes the gaps its words may hold, as the letter editor's Write With AI passes them: a
letter's own {{ names }} (`templates.assist.letterName`); any other gap is still marked. The prompt (version 6) says to write the whole text, nothing
invented and no sign-off (the mailbox adds the signature), to name only requests a read returned as
waiting on the person, and to put a suggested card in the text as a question.

**From question to done.**

1. **Offered.** The system turn lists the actions the person may draft (`authorise.allowedActions`:
   the grant held), each with its fields from the input schema's JSON Schema, only when the asking
   screen says `shows: ["cards"]`. An action the person may not run is never offered.
2. **Asked for.** A change missing what its action's `asks` name is asked for first, one question
   at a time with answers to tap (above); the card waits for the answer.
3. **Drafted.** The answer draft names one action and its values (`AiAnswerDraft.action`;
   `suggested: true` when the person did not ask for it). `engine/cards.draft` parses the values with
   the schema, drops a field the schema does not take, fills what it can from the context screen
   (its record id as the action's record field, when the schema has one), keeps a parse problem on
   its field for the person to fix, lists the records through `records()`, and refuses the whole
   card when the grant is gone or the records exceed `bulk`. Stored as `ai_action_draft` in the
   answer's transaction, status `shown`, 30 minutes.
4. **Shown.** The card lists the fields it carries as the action will receive them, ids by name,
   editable with the form system from the same schema and the screen's own pickers, the records
   named and linked, and nothing has happened.
5. **Confirmed.** One press for `standard`. For `approval`, `money`, `payroll` and `delete` the
   session must have confirmed within the last five minutes (`identity.provedAgo` against the
   card's window); else 403 `REAUTH_REQUIRED` and the screen asks Confirm It's You, starting on a
   passkey when the person has one, else the PIN, else the password (`useFreshSignIn`,
   `identity.md` §6), and presses again with the same `Idempotency-Key`. A person who confirmed
   with the PIN or the password and has no passkey is offered Set Passkey once on that device
   (a toast with the button; `localStorage` remembers the offer).
6. **Re-checked and run.** At the press, in order: the card is `shown` and not expired; the grant
   and scope now (`authorise.checkAction`); the values parse again (edited ones included); at most
   `bulk` records; the action's own `check` (each record in scope and in the state the card saw, the
   approval chain, no self-approval); then `ai_action_run` is opened `running` and `run()` is called
   once with the person as actor carrying their scope and an idempotency key. `run()` is the
   module's service function, which keeps its own transaction and `emit()`.
7. **Result.** The run closes `done` with `readback()`'s lines, or `failed` with the error's code and
   message; the card's status follows; `assistant.action_confirmed` or `assistant.action_failed`
   is emitted with the card, how it was confirmed and the result, never the question's words. A
   second press of the same card is `CARD_DONE` or `CARD_RUNNING`; the HTTP `Idempotency-Key`
   replays the first answer.

Limits: one card per answer; a bulk card touches at most 25 records; a card not pressed expires
after 30 minutes and the card offers Draw It Again, which asks the question afresh in the same
conversation; the model's text never says something was done.

**On screen** (`ActionCard` and `ResultLine` in the Assistant group; `app/src/features/assistant/Card.tsx`
wires them): the action's label as the title (a suggested card's as a question, "Send Message?"),
every field with a value, a problem or a requirement as a person reads it (a day day first, a
choice in words, an id as the name `names` or `records` give it, never an id itself: one nothing names
reads as its problem, Pick one, decision 32),
the records as chips that open their screens, and the buttons: the verb (the decision's own word
when the card carries one, "Approve ×3", and the count when it acts on several), Edit (the fields
through the form system from the action's own contract schema, resolved by its name; an id field
with `picks` through the screen's own picker, bound by the app: `TaskPeoplePicker`, `ColleaguePicker`,
`DepartmentPicker` for a reader who may view People, `ProjectPicker`, `LeaveTypeSelect` (Request
Leave's own list, each type with the days left), `EmployeePicker` (People's register), `WorksitePicker`,
`PolicyPicker`, `AddressField` for a place, and `ColleaguePicker` with the person for Add Work Site's
people; one without stays as it is;
Save Changes goes through `PUT /ai/cards/:id`, which names the new picks), Cancel (Not Now on a
suggested card). A question asked before a card shows its answers as buttons under its words, on
the newest answer only; a tap asks that answer as the person's next question, and every answer waits
until it lands (F26). The press is busy until the API
answers and the buttons beside it wait (F26); a refusal lands on the fields and under the card, in
the server's words, with the screen that answers it where one does (Open Mailbox for `NO_MAILBOX`,
Draw Signature for `NO_SIGNATURE`, which opens Edit Signature on Letter Templates);
done or failed, the result line replaces the buttons with Done or Could Not Finish and a line per
record, Open beside one with a screen, and the screen underneath refreshes in place (F28).

### 6.12 Reads replayed (decision 18; PR1)

Each read of an answer is kept as `ai_message_read` with its parameters. `GET /ai/answers/:id/reads/:n`
runs it again through `authorise.runRead` with the stored parameters and the person's rights at
that moment, 25 a page, and returns the rows as the Table shows them (`AiReadRows`: columns,
rows, numeric columns, each row's link). A person who lost a grant since sees nothing more; a read
that was refused or a summary is 404. The rows are drawn by the answer's table's rules (§6.4) as
they stand now, so a table kept before its records were named first gains their names here.

### 6.13 Summaries and the pane (decisions 13, 14; PR1 the shape, PR3 the summaries)

A module declares summary reads for its big tables beside its reads:

```js
summaries: [{
  key: "attendance.summary",
  description: "Lateness and absence counts by day, week or month, by person, department or site",
  params: c.attendance.AttendanceSummaryQuery,   // filters and the grouping; no page
  permission: ["people", "view"],
  run: (client, params, actor) => repo.summary(client, params, actor.scope),   // one SQL, the scope in it
}],
```

A summary returns `AiSummaryResult`: `figures` (up to 12: key, label, value, unit), `groups` (up to
3 groupings of up to 20 rows: key, label, value, count), `series` (up to 6 of up to 60 points) and
`total`; never rows. `authorise.runSummary` parses the result with the schema and refuses one that
carries rows. It is offered to the model as a tool like a read, counts as one of the five, and runs
inside the same read timeout (3 seconds, §6.3 step 8).

**The summaries (PR3).** Each is one SQL in its module's repo, with the reader's scope through
`scopeClause` (or the list's own audience: tasks, approvals, reviews), the grouping picked by a
`by` value the contract allow-lists and the repo maps to SQL (never the caller's words), groups
cut to 20 rows and top lists to 10 by `row_number()`, a series to its newest 60 buckets. The
figures, groups and series are named through `shared/ai/summary.js` (`figure`, `group`, `top`,
`series`, `periodOf`), so no module invents its own words for a count. A period is `from` and
`to`, or a `month`, else this Lagos month to today, at most a year.

| Summary | Module, grant | Params | Figures, groups and series |
|---|---|---|---|
| `attendance.summary` | `people` view | `AttendanceSummaryQuery`: period, `department_id`, `employee_id`, `by` person, department, site, day, week or month | Days, people, present, late, absent, on leave, minutes late and per late day, minutes worked, exceptions and open ones; by person, department or site: late days (20), most minutes late (10), absent days (20); by day, week or month: late days, absent days, minutes late as series |
| `tasks.summary` | `workspace` view | `TaskCountsQuery`: the board's `scope`, `status`, `assignee_id`, `cadence`, `priority`, `due`, `project_id`, `by` status, assignee, priority, due or cadence | Tasks, open, overdue, due today, due this week, done, done this week, blocked, people; by status and by priority always, then by assignee (20), due window or cadence |
| `leave.summary` | `people` view | `LeaveSummaryQuery`: the list's filters, `department_id`, `year` (this year unless a period is given), `by` status, type, person, department or month | Requests by status, days approved, taken, booked ahead and waiting, people, on leave today; by status and by type always, then by person or department (20), or by month as series (days approved, requests) |
| `approvals.summary` | `ess` view (the asker's own queue) | `ApprovalSummaryQuery`: `module_key`, `by` flow, stage, age or module | Waiting, past their time, due within a day, the oldest in days, flows; by flow and by age band always, then by stage or module |
| `goals.summary` | `performance` view, the reader's reach of the tree (`performance.md` §6.23) | `PerformanceSummaryQuery`: `period_id`, `department_id` | Key results by status, in recovery, the company score where the reader reads the whole plan; groups by status, latest score by function, ratings at the latest closed round; the company's and up to five functions' scores by month as series |
| `reviews.summary` | `performance` view, the reviews the reader may list | `ReviewSummaryQuery`: `round_id`, `kind`, `department_id`, `by` stage, rating, department or round | Reviews at each stage, waiting on me, the average score of closed ones; by stage and by rating always, then by department or round. Never a check-in's words |
| `employees.summary` | `people` view | `EmployeeSummaryQuery`: the register's filters, `by` department, status, work pattern, employment type, manager or confirmation | People, active, confirmed, on probation, confirmation due within 30 days or overdue, contracts ending within 30 days, no line manager, departments; by department and by status always, then by the dimension asked (managers 20, confirmation bands) |
| `audit.summary` | `settings` view with scope `all` and the CEO (anyone else is told it is not available, as the log refuses them) | `AuditSummaryQuery`: the log's filters (the last 30 days unless `from` or `to` says), `by` module or entity type | Entries, sensitive, people who acted, days, modules; by action (the catalogue's words, 20), by person (20), by module or record type; entries by day as a series |

**The summary cache** (`shared/ai/summary-cache.js`): the same summary with the same parameters
and the same scope asked again within 60 seconds is served from Redis, keyed by the asking person's
login and their scope, so a manager's figures never reach another person and a changed grant is a
new key; without Redis every call runs. `runSummary` says `cached: true` when it was.

**Past 200 rows** the pane's Table does not page on: it says how many rows there are ("Showing the
first 200 of 1,240 rows", TablePane) and its Export saves them all (§6.16).

The pane is built by the server from the turn (`engine/pane.js`): **Sources** from every read made
(name, filters, rows, total, outcome, masks); **Table** from the read the draft names, paged through
§6.12; **Record** from a chip or a row, shown through the person's masks; **Overview** from the
summary the draft names (`AiAnswerDraft.overview`: which summary, up to three figures by key, one
chart of bar, stacked bar, line or donut over one of its groups or series, and a sentence title). A
figure, group or series the summary does not hold is dropped; a chart title that names a number the
summary holds nowhere (not a figure, a group's value or count, a point or the total; a year or a date
is not a figure) is dropped for the group's or series' own label. The prompt (version 5) says how to
name the summary, the figures and the chart, and which chart suits a group (bar, donut) or a series
(line). The overview spec is kept only when the asking screen says `shows: ["pane"]`.

### 6.14 The engine boundary (decision 17; PR1)

`src/services/ai/engine/` is the part that would travel: `turn.js` (the rounds with the model, the
read cap, the forced answer, the correction and the rescue), `cards.js` (the draft rules, the
states, the expiry, the confirm classes), `pane.js` (Sources, Table, Overview from a turn),
`content.js` (what of a read goes back to the model), `matrix.js` (the test cases a registry
implies) and `errors.js`. It requires nothing of MyCity: `createEngine(deps)` takes the pieces
(how to run a read or a summary, how to check an action, how to talk to the model, the clock, the
limits) and the adapter in `services/ai/assistant/` supplies them. Gate 24
(`scripts/check/ai-engine-boundary.js`) fails a file in the folder that requires anything but Node's
builtins and its siblings, and a file outside it that reaches past `engine/index.js`. The React
views are a group in `packages/ui` (PR2). Extraction into JBS Praxis's own repository is a later
PR there.

### 6.15 The engine is told what changed (decision 22; gate 23, PR1)

`scripts/check/ai-awareness.js` fails the build when:

1. `src/shared/ai/catalogue.snapshot.json` differs from `registry.catalogue()`: every read, summary,
   action and route with its module, permission, risk and the hash of its parameter, input or
   prefill schema. A change to any of them is `npm run gen:ai-catalogue`, and the diff is reviewed
   with the PR, so a widened filter, a new field on a form's schema or a new action is seen;
2. an action's `input` is not a schema the module's own feature folder validates a form with
   (`useContractForm(..., <schema>)` in `app/src/features/<module>/`), unless the action says
   `form: "none: <reason>"` (a button with no form);
3. an action key is exercised by no integration test, or graded by no case of
   `scripts/ai/eval-assistant.js`;
4. a module that declares `actions` leaves a `<Thing>Create` schema of its contract neither offered
   nor in `not_offered` with a reason (PR5 makes this universal: every module with such a schema);
5. a Try Asking line names a read that does not exist;
6. a create or edit form is not in the chat (decision 33): a `<Thing>Create`, `Edit`, `Update`,
   `Patch` or `Save` schema of a built module's contract that is no action's input, whose module's
   `not_offered` reason does not start with `via <action key>:` (an action that exists) or one of
   the never words `secret:`, `device:`, `personal:`, `file:`, `ai:`, `design:` (or, for a module opted out
   whole, whose `// ai:none` reason does not start with one), and that is not on the list of gaps,
   `scripts/check/ai-forms-gaps.json`. The list only shrinks: an entry now offered, reached or
   never, or naming no schema of a built module, fails until it is taken off, and an entry the
   change's base did not hold fails, so a gap is closed, never added. `--list` prints every create
   and edit schema and how it is accounted for.
7. a field a card needs is never asked (decision 34): a field an action's input requires (its JSON
   Schema's `required`, among the fields the card carries, with no default) that no ask of the
   action names without a `when`, and that a file does not fill (`from_file.fills`, §6.18). A field
   required only in some states is the action's own to ask with `when`; a field that names a record
   is asked with `read`, so its answers are the person's own records;
8. a kind of document (a manifest's `files`, §6.18) that no integration test names as `file.<kind>`,
   or that no case of the evaluation set reads with `file: "<kind>"`.

### 6.16 Download Excel (decision 15; PR3)

Every answer export takes the one export path (`foundation.md` §6.12), never a file built inside the
request:

1. `POST /ai/answers/:id/reads/:n/export` finds the read as §6.12 does (the caller's, a list or
   record read that returned; 404 otherwise), reserves an `ai_answer_export` document for the caller
   in the request's transaction (`exports.reserve`) and emits `assistant.read_export_requested`
   (the asker, the document, the answer, `n`, the read key; never the words), answering 202
   `ExportFile`.
2. The outbox handler (`assistant.export.js` `buildReadExport`) runs in the worker after commit: the
   asker must still be active and the answer still theirs; it replays the read page by page through
   `authorise.runRead` with the asker's rights and masks as they stand then, up to 25,000 rows
   (`READ_EXPORT_CEILING`, one constant), drawing each page as the Table shows it (the answer's own
   columns when its table came from this read, else the rows' first plain fields; dates day first,
   naira with two places), and writes the workbook with `shared/spreadsheet`.
3. The workbook has two sheets: the rows, named after the read, and **About This File**: who exported
   it and when (Lagos), the question and when it was asked, the read and its filters, the rows in the
   file and the rows the read has now, whether it was cut at the cap, the masked fields the asker's
   role hides (by their names), and the environment (a staging file says so, as its name does).
4. The screen's Export on the Table (`app/src/features/assistant/Pane.tsx`, the shared `ExportButton`
   through `DataView`) asks for the file and waits on `GET /exports/:id`, then downloads
   `GET /documents/:id/content` (`app/src/api/exports.ts`, as every export); the vault keeps the file
   24 hours and the `export-cleanup` job removes it. Only the asker (and the CEO, as every document)
   may open it.

A person who lost the read's grant between the press and the build gets a failed file; one who lost
part of their scope gets fewer rows. Nothing is emailed.

### 6.17 Proof: the matrix's probes, the attack suite and the nightly run (decision 26; PR5)

Three proofs stand behind decision 16, and two of them run on every pull request.

**The matrix** (`tests/integration/ai-matrix.test.js`, generated by `engine/matrix.js` from the
registry) crosses every read, summary and action with every seeded role and the CEO on the staging
seeds: a role is offered a tool exactly when `scopeFor` would allow the screen, a refused tool is
refused when run, a scoped person's rows are a subset of the CEO's and carry no masked field. Each
module with team or own scopes gives its scoped reads and actions a **probe**, `matrix: { inside,
outside }`, beside its `run`: `inside(ctx)` is a record within the asking person's reach and
`outside(ctx)` one beyond it, each built on the fly through the module's own service (a task set by
the person, a leave request by a report of theirs, one by an outsider nobody manages), or `null`
when there is nothing to assert for that person (a reader with no report, a role that sees
everything has nothing outside). The suite gives each role one report and itself one outsider, and
hands every probe a `ctx`: the actor with the tool's scope, the tool's key, their report, the
outsider, the annual leave type, a fresh working day, their capabilities and `scopeOf()`. A read must
return the inside record and never the outside one; a card naming the outside record must be
refused by `authorise.checkAction` or the action's own `check`. Probed: Workspace (`tasks.list`,
`tasks.complete`, `tasks.comment`, `tasks.edit`, `tasks.add_step`, `tasks.edit_step`,
`tasks.wait_on`, `projects.edit`, `calendar.month`, `calendar.edit`), People (`employees.list`, `leave.requests`,
`leave.approve`, `leave.reject`, `attendance.register`, `overtime.approve`, `leave.record`,
`employees.edit`, `employees.reporting`: a report inside, the outsider refused by the card's own
check), Home (`team.today`, `activity.list`), ESS (`my_profile.get`, `my_leave.list`), approvals
(`approvals.mine`, `approvals.decide`), Performance (`scorecards.create`: a scorecard for one's
report, never for the outsider) and Staff Community (`channels.list`, `community.post`,
`community.message`, `channels.edit`, `community.recognise`, `community.wish`,
`community.edit_message`). Performance's reads and its other cards, and Queries, carry no probe:
their records need a quarter, a plan, a round or a raised query the suite does not build, and their
scope stands on their own suites, the subset rule and the module's own rules re-checked at the
press. A manifest's probe calls services only; gate
19 refuses SQL in it like anything else.

**The attack suite** (`scripts/ai/attack-assistant.js` names the attacks; `tests/integration/ai-attacks.test.js`
runs each with the model scripted to try it) is every way a person might put the assistant to
learning or doing what their own screens would not: another person's pay and bank account; a record
by a guessed id; instructions planted in a direct message (which never reach the model: Praxis AI
reads no message), in a task's note and in a policy (which reach it as data and change nothing, the
tool list being code's); an action on a record outside the person's scope; approving one's own
request; a card pressed after the grant went; a bulk card over 25; a mail to an outside address the
model offers unasked; a read the person was never offered. Each fails safely, with nothing written,
and the suite asserts the refusal was counted (below) and that a run's record and its leak notice
work end to end.

**The nightly run** asks the same questions of the real model on staging, as a real person of each
role, through staging's own engine: `.github/workflows/ai-nightly.yml` at 02:17 Lagos calls
`deploy-gate attack`, which runs the script as the release staging runs (`--nightly --json`), taking
no deploy lock and writing nothing of a person's. The script grades each answer as the evaluation
set does (§6.10): `never` (no rows from a read the grant does not reach), `no_masked` (no row carries
a field the person's role hides), `no_cite` (a guessed record is not cited), `no_action` and
`no_suggested` (no card from a planted instruction, none offered unasked that carries a record out),
`refused_check` (a card naming a record outside scope is refused by the server's own check),
`bulk_within`; a model that tries and is refused is `caught`, which is the design working, and only
an answer that gave the person what their screens would not is a **leak**. The attack that needs a
grant removed is `ci_only`. The run is recorded on `ai_attack_run` through AI Control's service
(`recordAttackRun`: `passed`, `leaked`, `cannot_run` when no provider is set up or nobody holds a
role, `failed`), so **AI Control · Spend** shows the last run beside two more figures,
**Reads Refused** (`ai_message_read` with outcome `refused` this month: a read the model asked for
that the person's grant did not reach) and **Presses Refused** (`assistant.action_refused` this
month: a press refused before anything ran, the grant gone, a record outside scope or the person's
own request; a refusal from the action's own run, a request already decided, is a failed press, not
a refusal of rights). A leak is `ai_control.attack_leaked`, the one notice AI Control sends: urgent,
to whoever holds `ai_control` edit, pushed to every device, closed only on Acknowledge, opening
Spend (`ai-control.md` §7, §10). The workflow fails loudly on a leak and warns on a run that could
not run. Production is refused, as the evaluation set is.

### 6.18 Documents in the chat (decisions 41 to 48; Appendix A)

**Built for invoices and payment receipts (PR 1, 13/11/2026); contracts and MoUs are PR 2.** Where
the build taught the design otherwise, the change is written here and in the Change log.

**The contract** (`packages/contract/schemas/assistant.js`):

- `AiAttachmentKind`: `invoice`, `payment_receipt`, `contract` (the tile reads Contract or MoU).
- `AiAttachment`: `{ document_id, kind }`; `AiAsk.attachment` takes one, optional. With an
  attachment the question may be left empty: the server asks the kind's own question ("Raise an
  expense request from this invoice", "Record the payment on this receipt", "Summarise this contract
  and file it"). Without one an empty question is refused as before.
- `GET /api/v1/ai/attachment-kinds` → `AiAttachmentKinds`: the kinds this person may attach
  (`kind`, `label`, `question`), in the order the modal shows them, and `available` (false while
  reading is off: AI switched off, Praxis AI's switch off, no provider set up, or the month's cap
  reached, as `drafts.availability` says for every Write With AI). Not paged: at most three rows, a
  fixed list. A kind no module declares yet (`contract` until PR 2) is never listed.
- `AiAnswer.attachment`: `{ document, kind }` or null (`documents.DocumentRef`), kept in
  `ai_message.metadata.attachment` with the reading and replayed with the conversation, so the
  question's bubble shows the file it was asked about. No new table and no migration for the
  assistant (Expenses' negative line needs one, below).

**The upload.** The modal uploads through the upload engine (`POST /api/v1/documents`, gate 18) with
the purpose `ai_attachment` (10 MB): `shared/files/mime-policy.js` takes PDF, JPEG, PNG, WebP and
HEIC for it (the upload engine's sniffer names a HEIF photo `image/heic`, so the one type takes
both), and the AI client's `FILE_TYPES` gains `image/heic` and `image/heif`, which Gemini reads.
The file is a staged upload (`staged_upload`): its uploader's alone until a record claims it. The
card the person presses claims it (`vault.claim`), as the screen's own form does: the request's
invoice (`expense_invoice`), the disbursement's receipt (`disbursement_receipt`). A file never
claimed stays staged under the upload engine's own rule.

**The ask** (`assistant.service`, `assistant.files.js`). With an attachment, before the model is asked:

1. The kind must be among the person's `attachment-kinds` (else 403 `ATTACHMENT_FORBIDDEN` on
   `attachment`), and the document their own staged upload (else 404, `attachment: Upload it
   again`). A file of a kind the model cannot read, larger than `FILE_MAX_BYTES`, or whose scan is
   pending or infected is answered as `unreadable`.
2. Governance as for any question (§6.1), then the kind's reader runs once, outside any transaction,
   on its own action and job. Its spend is that action's in AI Control.
3. The reader's result goes into the turn as read 1, `file.<kind>` (`kind: "read"`, the module that
   declares the kind), its fields given to the model with the question, through `redactValue` as a
   read's rows are (an account number never reaches the chat's model), cited as the document
   (`entity_type: "document"`, the file's name). It is shown on Sources like any read, counts as
   one of the five (the model has four more), and is never replayed (`GET /ai/answers/:id/reads/1`
   is 404). The file itself never goes to the chat's model; only the reader's fields do, so words
   written in a document are data and never instructions.
4. The model answers from it and drafts one of the actions the kind offers (§6.11). The server then
   lays the reader's values over the model's (decision 44) **before the ask guard** (`askFirst`), so
   a field the file gave is never asked, and before `authorise.checkAction` checks them; the
   reader's own problems (`Check the lines`, `Naira only`) join the card's. When the model drafts no
   card and asks nothing, the kind's card is drawn anyway, as asked when the question is the kind's
   own, else as suggested. The card names the file on its field (Invoice, Receipt) by the file's
   name (`names`), never as a record: records are what the press acts on and count on the verb. The
   file opens from the question's chip.
5. A reader that cannot read the file (`unreadable`), is off (`off`) or has no budget left
   (`limit`) answers that in one sentence ("This file cannot be read. Try a clearer copy.", "Reading
   documents is off.", "This month's AI budget is spent."), with no model asked, no card and nothing
   more spent. The server's own sentences (an invoice paid in full, a possible duplicate, a receipt
   already paid) are added to the model's words, one each (`notes`).
6. A later question in the same conversation sees the reading again from the replay (the turn's
   words carry it, `metadata.attachment.reading`), and the reader's values are laid over that
   question's card too, so a tapped answer ("Which request was paid?") draws the card with the
   file's figures. The file is not read twice. The newest attachment of the conversation is the
   one that counts.

**Where a kind lives.** A module's manifest declares the documents it reads beside its reads,
checked by `defineManifest` and refused anything that writes (gate 19):

```js
files: [{
  kind: "invoice",                                   // an AiAttachmentKind
  label: "Invoice",
  permission: ["expenses", "create"],                // who is offered the tile; `capability` beside it when one is needed
  question: "Raise an expense request from this invoice",
  read: (actor, doc, db) => receiptAi.readForChat(actor, doc, db),   // the module's own reader; returns data, writes nothing
  actions: ["my_expenses.from_invoice"],             // the cards it may draw, the first drawn when the model drafts none
}],
```

`read` answers `{ outcome, reading, card, notes }`: `outcome` `read`, `unreadable`, `off` or
`limit`; `reading`, the fields the model sees; `card`, `{ action, values, problems, choices }` or
null (null draws no card); `notes`, the server's sentences. An action drawn only from a file says
so beside its fields, `from_file: { kind, fills }`: it is offered only while the conversation holds a
file of that kind, and the fields in `fills` come from the reader, so gate 23 rule 7 counts them as
asked. The registry lists the kinds a person may use (`registry.filesFor(actor)`) and checks each
kind's actions once every manifest has loaded; gate 23 rule 8 holds each kind to an integration test
naming `file.<kind>` and an evaluation case with `file: "<kind>"` (a made-up sample under
`scripts/ai/samples/`, which the set uploads as the person before it asks).

**Invoice** (Expenses' own code, `expenses.receipt-ai.js`):

- The reader is Read Invoice's, widened: `ExpenseInvoiceRead` (the model's output) gains `subject`,
  `invoice_number`, `issued_on`, `currency`, `total`, `paid_to_date`, `balance_due`, `bank_name`,
  `account_name` and `account_number`, and its lines may carry a negative unit price (a discount).
  `ExpenseInvoiceSuggestion` (what New Request's own Read Invoice returns) gains the bank fields too,
  so the form fills the payee's bank from the same reading.
- The server builds the lines (decision 45): the items as read, then, when `paid_to_date` is above
  zero, one line `Paid to date on <invoice number>`, quantity 1, its unit price the amount paid,
  negative. It counts the lines through `shared/money`; when the invoice gives `balance_due` and the
  lines do not come to it, the card shows `Check the lines` on its lines. A total of zero or less
  draws no card: the answer says the invoice is paid in full. A currency other than naira shows
  `Naira only` on the lines. More than 25 lines shows `At most 25`.
- The card is a new action, `my_expenses.from_invoice` (label New Request), on a new card schema
  `ExpenseRequestFromInvoice`: the request's fields (`ExpenseFields`) with every line and
  `invoice_document_id` required, and `submit` (on by default, as New Request's card). Its purpose
  is the invoice's subject with its number ("Website ticket payments, INV-202611-9525"), else
  `Invoice <number> from <payee>`; its payee Vendor unless the payee is a partner the person sees
  (Partner) or the person themself (Staff); its bank, account name and account number the
  invoice's; its category among those offered, else asked ("Which category?"); its project by name
  among the running projects, else left empty; its department the person's own. A request still a
  draft offers Add Another Item and Send Request once pressed (`then`, §6.11).
- The card's lines are a card field kind of their own, `lines` (an array of items with a
  description, quantity and unit price): a table (Item, Qty, Unit Price, Amount) with the total
  under it, and on Edit a `LinesField` from `packages/ui/src/form/`, the same field New Request's
  form uses. `MoneyField` gains `signed`: a leading minus is kept and accepted (a discount, a
  payment already made), shown in the destructive token; without `signed` a minus is refused as
  before.
- Expenses' service (`expenses.md` §6.1 rule 1): a line may carry a negative unit price; the
  request's total must be above zero, else 422 `EXPENSE_TOTAL_NOT_POSITIVE` on `lines` ("Total
  above zero"). Migration `8030_expense_line_discount.sql` (M8's block, beside the table it
  changes) drops 8010's CHECKs on a line's unit price and amount; the quantity stays above zero.
- Before drafting, the reader asks the expenses service for a possible duplicate (`expenses.md`
  §6.8: the same payee, by account number or name, and the same amount, sent within 30 days, only
  those the person may open), and the answer names it in one sentence ("EXP-0012 asked the same
  payee for the same amount on 12/11/2026."); the card is still drawn.

**Payment Receipt** (Disbursements' own code, `disbursements.receipt-ai.js`):

- The reader, `disbursement-receipt-read` (Image Reading, `personal_data: true`, chosen by TB),
  returns `DisbursementReceiptRead`: `payment_reference`, `paid_on`, `amount`, `beneficiary_name`,
  `beneficiary_account_number`, `beneficiary_bank`, `narration`.
- The match is the disbursements service's, in SQL through its repo, never the model's: authorised
  requests within the person's `expenses` scope whose account number equals the beneficiary's (else
  whose payee name equals it, case and accents set aside) and whose amount equals the receipt's. One
  fills `expense_request_id`; several make the card's question "Which request was paid?" offer them
  to tap; none asks the same question with the authorised requests to tap (decision 34: a required
  field is asked, never left to Pick one). A request already paid is named in the answer ("EXP-0004
  was already paid as DSB-0004.").
- The card is Record Disbursement's own, `disbursements.create`, now carrying
  `receipt_document_id` from the attachment, named by the file's name, and the reference and day
  from the reading; its risk stays `money`, so its press asks Confirm It's You.

**Contract or MoU** (PR 2, Partnerships' own code, not built yet):

- The reader, `agreement-document-read`, returns `AgreementDocumentRead`: `title`, `kind` (`mou`,
  `service_agreement`, `contract`, `other`), `parties` (name, role), `signed_on`, `starts_on`,
  `ends_on`, `notice_days`, `value` (money or null), `renewal` (a sentence), `obligations` (party and
  one sentence each, at most eight), `signatories` (name, title).
- The answer summarises it in at most five sentences, and the pane's Record tab shows every field
  (the Record tab's own layout, `RecordPane`).
- The filing card: when one of the parties is a partner the person sees with an agreement in
  `sent` or `viewed`, a new card `agreements.record_signed_copy` (`AgreementSignedCopyAdd`: the
  agreement, the document, `signed_on`, `signed_by_name`, `signed_by_title`, from the reading),
  through the route's own service, risk `approval` (it seals and locks the agreement); several
  agreements ask which. Otherwise a new card `partner_documents.attach` (`PartnerDocumentAdd`: the
  document, its kind among the `partner_document_kind` codes (MOU or Service Agreement as the
  reading names it, else picked on Edit), the partner or lead matched by name among the person's
  own, the deal optional), through Upload Document's own service, risk `standard`. `not_offered` loses its
  `file:` reasons for `SignedCopyRecord` and `PartnerDocumentAttach`: each is reached `via` its card.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `assistant.answered` | A question answered and saved | Audit only: the conversation, the message, the read keys; never the words |
| `assistant.conversation_deleted` | Delete Conversation | Audit only |
| `assistant.history_cleared` | Clear History | Audit only |
| `assistant.feedback_given` | Helpful or Not Helpful | Audit only |
| `assistant.export_requested` | Export on History | Outbox: the workbook of the person's questions, made after commit (`assistant.export_history`); a person no longer active gets a failed file |
| `assistant.read_export_requested` | Download Excel on an answer's Table (§6.16) | Outbox: every row of the read, replayed with the asker's rights now, into the file the request reserved (`assistant.export_read`); at most 25,000 rows; a person no longer active, or an answer that is gone, gets a failed file |
| `assistant.card_drafted` | An answer carried a card (§6.11) | Audit only: the card, the action key, the records; never the words |
| `assistant.action_confirmed` | A card pressed and its action run (§6.11 step 6) | Audit only: the card, the run, how it was confirmed, the result lines; the module's own event carries the change |
| `assistant.action_failed` | A press whose action refused or failed | Audit only: the card, the error code |
| `assistant.action_refused` | A press refused before anything ran for want of rights: the grant gone, more records than the action allows, the action's own check (a record outside scope, the person's own request) (§6.17) | Audit only: the card, the action key, the error code and whether the grant or the check refused it; AI Control · Spend counts them as Presses Refused |
| `assistant.card_cancelled` | Cancel on a card | Audit only |
| `ai:progress` (realtime, not an outbox event) | Before each read or summary of a question runs (§6.1.8) | Pushed to the asking person's room with the question's `Idempotency-Key`, which read of the five it is and its words; nothing recorded |
| `export-cleanup` (the vault's, not this module's) | Hourly | Removes recordings an hour old: their request never finished (§6.6) |

Nobody is notified of anything.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Every role with `praxis_ai` (all seven seeded roles) | Ask and History, their own conversations only | Ask, record a question, give feedback, delete their own conversations; press the cards their own grants reach (§6.11): a task and its change, a comment, a step, a link between tasks, a project and its change, an event and its change, their week's Support Needed, their own leave request, a message, a post, a mail from their own mailbox; a request waiting on them in My Approvals |
| A holder of `workspace.late_reasons` (Management, Operations & People, the Implementation Team) | The same | Add a late reason, or switch one off or on, from the chat as from Late Reasons |
| Every member of staff | The same | Add a work site for themselves and colleagues, for approval; send the response to a query of their own |
| A line manager, a head of department (`people` approve, team) | The same | Approve overtime beforehand for their reports, after Confirm It's You |
| Operations & People, the Implementation Team (`people` all); Management (`people` all, create and edit) | The same | People's cards: record leave and change a leave type's allowance (Confirm It's You), add a leave type, add an employee and save a record or a line (the work record alone), add and save a department, an open role and a worksite |
| A holder of `queries.configure` (Operations & People, the Implementation Team) | The same | Save a rule, add or save a step of the chain, add or save a letter |
| `queries` create (managers, heads, People) | The same | Raise a query, after Confirm It's You, signed with their saved signature |
| A holder of `policies.manage` (Operations & People, the Implementation Team) | The same | Start a policy and save its draft |
| Everyone with `performance` edit, `ess` create, `community` create and `mailbox` edit (every seeded role) | The same | A line of their own check-in; a change of target they may ask for; a score on a review they review, after Confirm It's You; a scorecard for someone in their scope, and its lines while it is a draft; a channel, its name and purpose as its admin, a recognition, wishes on a celebration card, their own message while it may still change; their own signature |
| Whoever sets goals and KPIs (`goals.organisation`, `goals.company`, `goals.function`: `performance.md` §8) | The same | The organisational goals and their sharing; the company's or their function's objectives and key results while the plan is open, a company objective's sharing, Request To Unbind; their function's KPIs |
| A holder of `performance.manage` (Operations & People, the Implementation Team) | The same | Set up and change a quarter, open a round, change a scorecard's reviewer, start and change an improvement plan (after Confirm It's You) |
| A holder of `announcements.post` (Operations & People, Management, the Implementation Team) or `mailbox.signature` (System Administrator, the Implementation Team) | The same | Publish an announcement or change one waiting to go out; configure the company's signature |
| A line manager (`people` approve, team), Operations & People and Management (`people` approve, all) | The same | Approve or reject the leave requests waiting on them, up to 25 a press, after Confirm It's You; never their own |
| What each person learns | Exactly what their own grants, scope and field visibility show on screen | |
| CEO | Everything, by the standing rule, through the same reads | The same |
| Anyone with AI Control `view` | On History, the company's figures: questions this month, spend, the cap, spend per month, questions by module | Nothing more: never another person's questions |

The `praxis_ai` scope (`all` for the Implementation Team, Operations & People and Management, `own`
for the rest) does not widen History (§1.1 decision 7); a read's scope comes from that read's own
module grant. Restricted fields reach the model only for a person who sees them on screen.

## 9 · AI and search

- **AI reads**: none (`// ai:none` in the controller): a person's questions are their own, and the
  assistant never reads its own history as data.
- **AI routes**: none. **AI actions**: none of its own; the cards it runs belong to the modules
  that declare them (§6.11).
- **Search** (`assistant.search.js`): the person's own conversations by title, pinned to their
  `user_id` like the mailbox (`owner`), opening the conversation on Ask (`ai_conversation` in the
  route map, `/praxis-ai?tab=ask&id=`). Words: conversation, question, chat, asked. Screens: Ask ("ai", "assistant",
  "chat", "question"), History ("ai history", "past questions", "conversations"), and New
  Conversation as Ask's New action.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Praxis AI · Ask (`ask`) | Praxis AI as the title; Back (on desktop the screen it returns to under the title, "From People · Leave"; opened from the menu, ⌘K or History it goes to History and the line is left out); Recent, a toggle that shows the person's conversations as a column beside the chat (titles and when last asked, newest first, 25 a page; empty, No Questions Yet); New Conversation once a conversation is open; on a phone opened from the menu, the conversations first (title, questions, when last asked; Search Conversations; No Conversations Yet, "Start one with New Conversation.") with New Conversation always, and the chat full screen over them with Back, Conversations and New Conversation; the conversation (on desktop about two fifths, on the left): empty, an illustration and Try Asking with up to 6 questions to tap; Show Earlier when older questions remain, each question as the person's bubble, each answer with its words, its table (`DataView`, bare), Showing 25 of 312 when its read had more (Showing 26 to 50 of 312 on a later page), Show Next 25 on the newest answer that has more, its screen button ("Open Leave"; a change opens its form filled, §6.4), its table's rows opening their records, Open Figures on an answer with a table or figures whose pane is not the one shown (none under an answer of words alone, whose chips still open the pane), From with the kinds of record read as chips ("partnership ×4", "employee ×2"; a chip shows those records in the pane; the one record, named, when the answer rests on one, shown on Record), Helpful and Not Helpful (pressed again, taken back); a question Praxis AI asks before a card ("What is the task?", "When is it due?", "Which Tunde?", "Which leave type?"; decisions 28, 29 and 32), its words alone with no From and no Open Figures, with its answers as buttons under it on the newest answer (Today, Tomorrow, Friday, No Due Day; Low, Normal, High, Urgent; 30 Minutes, 1 Hour, 2 Hours; Just Me; each person by name and job title; each leave type with the days left, "Annual Leave, 12 days left"), a tap asking it; an answer's card (§6.11): the action's name (a suggested card's as a question, "Send Message?"), each field's label and value as a person reads it (people, departments, projects and leave types by name, never an id, "For: JBS Praxis Team", "Watchers: Tobiloba Dada, Bassey Ekpe"), a problem beside its value ("Say why", "Fill the gap"; Pick one alone where an id names nothing), the records as chips ("Ayo Bello, Annual, 3 days"), the buttons (the verb with the count, "Approve Leave ×4", a lock on one that asks Confirm It's You, none while a field shows a problem; Edit, the primary button then, with Save Changes and Cancel on its fields, people, departments, projects and leave types picked as on the screen's own form; Cancel, or Not Now on a suggested card), a refusal under the card in the server's words with Open Mailbox where the mailbox is not connected, then Done or Could Not Finish with a line per record and Open, or Expired with "This card has expired." and Draw It Again; Confirm It's You (`identity.md` §10) before a sensitive card, and the toast "Set a passkey for next time" with Set Passkey once; while waiting, Reading Your Records, then Reading leave requests · 2 of 5 as each read runs; a refused answer in plain words; a failed one with its reason and Try Again; the pane (on desktop about three fifths, on the right) for the latest answer that read records or has figures (a conversation opened from Recent or History shows its own; an answer with neither, such as a card drawn from what was said, leaves the pane as it was, never blank), or the one whose chip or Open Figures was pressed (drawn in the accent): tabs Overview, Table, Record and Sources, an empty one disabled; Overview: up to three figures and one chart when a summary read answered (§6.13); Table: the read's rows, 25 a page (Previous, Next, Page 1 of 13), Export (every row of the read as an Excel file, made for the person and saved on this device, §6.16; toast "Export downloaded"), a row opening the Record, past 200 rows "Showing the first 200 of 1,240 rows"; Record: the row's or the record's fields and Open Record; Sources: each read numbered and named ("1. Leave Requests"), Read, Not Available, Not Run, Failed or Too Much (the read covered more than the database allows at once, §6.3 step 8), "25 of 312 rows", its filters, Masked with the fields emptied, Open Table; before any answer, No Answer Yet, "Ask a question to fill this pane."; the box: Ask a Question, the microphone (Record Question, then the time and Stop Recording) and Send; toasts "Thanks for the feedback", "That conversation was deleted", a refused question's reason, the microphone's problem (Microphone not allowed, No words heard, Transcription is not set up, the server's reason, Could not transcribe); a 500's reference after its reason | Help term on From (the records this answer was read from, as you would see them; a chip opens them in the pane) | How reads, the context, permissions, redaction, the loop, the progress events and a card's re-check work: §1.1, §6 here and the manual |
| Praxis AI · History (`history`) | History as the title, Export and Clear History; for AI Control: Questions This Month (everyone's), Your Questions, Spend and Monthly Cap, each captioned with the month or All AI; for everyone else: Questions This Month, Your Questions (all time) and Your Spend; Your Questions, 25 a page: Question, Asked, Sources Read, Tokens, Cost, a row opening it on Ask, a row menu with Delete Conversation, confirmed in the shared dialog; Search Questions; empty: No Questions Yet, "Ask one on the Ask tab."; Clear History, confirmed in the shared dialog ("Clear History", "Every conversation is removed.", Clear History); Spend per Month, Naira (six months; for AI Control, "Against a ₦25,000 monthly cap" when one is set); Questions by Module; toasts "Conversation deleted", "History cleared", the export's own | Help terms on Spend (what Praxis AI's questions cost this month, priced as AI Control prices them) and Monthly Cap (the most all AI may spend in a month, set in AI Control) | Where everyone's spend by action is (AI Control · Spend), what deleting keeps: §6.5 |
| Praxis AI · Ask, Attach Document (Appendix A) | Attach Document, a paperclip icon button with its Tooltip, left of the question box; its modal, Attach Document: What Is It? with three tiles (**Invoice**, **Payment Receipt**, **Contract or MoU**, each with its icon and a caption of at most four words: Bill to pay, Proof of a transfer, Signed or to sign), only those the person may use; then the file through `UploadField` (PDF, JPEG, PNG, WebP, HEIC, HEIF; at most 10 MB), its name and size with Remove; Question, Optional, filled with the kind's own question; Cancel and **Read Document** in the footer. While reading is off, Attach Document is off with the Tooltip Reading Documents Is Off. The question's bubble carries a chip with the file's name that opens it. The answer: its card, or one sentence when the file cannot be read | help on the modal's file field: "PDF or a photo, up to 10 MB." | why the kinds are picked first, how the server checks the figures, the jobs: decisions 41 to 48, §6.18 here, the manual |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Praxis AI · Ask (`ask`) | Opened from a screen (⌘K on a screen, a link with `from`): Back and Praxis AI as the title, New Conversation once a conversation is open, the conversation full width with the box pinned at the foot (the microphone and Send as 44 px targets); a question's answers one under the other, full width (44 px); an answer's card inside the bubble, its fields one under the other, the verb full width at its foot with Edit and Cancel above it (44 px), Edit's pickers full width, Confirm It's You as a sheet; Open Figures under an answer with a table or figures opens the pane as a sheet, Figures, with the four tabs: the Table as cards (44 px rows, Previous and Next full width), Open Record full width. Opened from the menu or History: Praxis AI as the title with New Conversation, then the person's conversations, newest first (title; questions and when last asked), Search Conversations, 25 a page; empty, No Conversations Yet. A conversation, or New Conversation, opens the chat full screen over the list: Back, Praxis AI as the title, Conversations (the other conversations as a sheet, as a channel's switcher is) and New Conversation; the conversation fills the screen; empty, Try Asking as a tap list; an answer's table as cards | The pane beside the chat (a sheet from Open Figures instead); Recent and its toggle (the list is the landing page instead); the screen's name under the title | New Conversation under the title and in the floating button; inside a chat, Conversations and New Conversation in its header; Open Figures under an answer | The floating button's Praxis AI opens this screen from any other, with that screen as the question's context and where Back returns (§3 step 8, decision 27); More, then Praxis AI; tabs Ask and History; Back, the phone's own Back and Escape return to the screen it was opened from |
| Praxis AI · History (`history`) | The figure cards two to a row, then your questions as cards (question, asked, cost) | Sources Read and Tokens on each question; Spend per Month; Questions by Module | Tap a card to open its conversation on Ask; Delete Conversation in its menu's sheet; Export and Clear History in the page's menu | As above |
| Praxis AI · Ask, Attach Document (Appendix A) | Attach Document as a 44 px icon button left of the box; the modal as a full sheet: the three tiles one under the other, full width, then the file field (the phone's picker offers the camera) | the file's size | **Read Document**, full width at the foot of the sheet | the sheet's Back or Cancel returns to the chat |

## 11 · Edge cases

- **No AI provider set up** (a laptop, CI, a staging server without a key): the stub answers,
  marked as a placeholder, with no reads; the ledger records it (`vendor: stub`).
- **AI switched off, Praxis AI's module switch off, or the month's cap reached**: no model is
  asked; the answer line says so in a few words and nothing is spent.
- **Every model in the chain passed by or failing**: `AI_UNAVAILABLE`, Try Again.
- **The model names a read the person may not run, or one that does not exist**: it was never
  offered; the call is refused as not available and the loop carries on.
- **Parameters that do not parse**: sent back once to be corrected; a second failure counts as a
  read that returned nothing.
- **Five reads used, or the same read asked twice**: the model is told to answer with what it has.
- **A huge list** ("all our staff"): the first 25 and the total; Show Next 25 asks for the next page
  as a follow-up in the same conversation.
- **A question that needs a total over more than one page** (a sum of 400 records): answered from
  the module's summary read (§6.13: attendance, tasks, leave, approvals, performance, reviews,
  employees, the Audit Log); where a module has none, the answer gives the total, says it looked at
  the first 25 and names the screen (the prompt says so and never to estimate the rest). A module
  adds a summary read when its questions need one.
- **A read that would scan too much** (a year of attendance by person for the whole company on a
  slow night): the database cuts it at 3 seconds (§6.3 step 8); the model is told "too much" and
  asks for a shorter period, a department or a person, or uses a summary; the Sources tab shows the
  read as timed out; nothing is estimated.
- **A list past 200 rows in the pane**: the Table stops paging and offers Download Excel (§6.13,
  §6.16); the file holds at most 25,000 rows and its About This File says when it was cut.
- **The connection drops while waiting** (Ifeoma's bad network zone): the answer is saved; the
  conversation shows it on reload, and a first question's answer is in Recent and History. Try
  Again sends the same `Idempotency-Key`, which returns the same answer, never a second run.
- **The person moves to another conversation, or leaves, while an answer is being made**: the
  answer is saved where it was asked and shown there; the conversation on screen is not touched.
- **A question refused as it stands** (a 4xx other than 404 and 409, such as one over 500
  characters, and `AI_DISABLED`, `AI_MODULE_DISABLED` and `AI_BAD_OUTPUT`, which asking the same
  words again cannot change): the words go back to the box with the reason in a toast; Try Again is
  only for a question that may succeed if sent again. A 500's red line carries its reference.
- **Send pressed while an answer is coming**: it spins until that answer lands, and the words stay
  in the box.
- **Anything unexpected while answering**: the run is recorded `AI_FAILED` and the screen gets the
  same (500, "The assistant could not answer. Try again."), not the generic fault.
- **A person loses a grant after asking**: their History keeps the old answer's words; a citation
  opens through the screen's own check, which may now refuse.
- **A cited record is deleted later**: the citation opens the screen's not-found state.
- **A conversation deleted in another tab**: Helpful or Not Helpful on its answer, or deleting it
  again from Recent or History, says "That conversation was deleted" (the list reloads). Asking in it is 404 and the screen starts a new
  conversation with the same question in the box; opening it (from History or ⌘K) does the same,
  with "That conversation was deleted"; deleted while its answer was being made, the question is
  saved in a new conversation.
- **A recording that never transcribes**: the box stays empty and the reason shows by the
  microphone: the server's own (AI off, the cap, no model answering), "Transcription is not set up"
  for the stub's placeholder (never put in the box), "No words heard", or Could not transcribe when
  the recording did not reach the server; the recording
  is removed in the same request, or by the vault's sweep once an hour old.
- **A question in another language**: answered in English.
- **A card the person did not ask for** (decision 20): drawn marked suggested, read as a question,
  never run unasked; Not Now cancels it. One card per answer, so a suggested one never joins a card
  the person asked for. Its gaps are never asked for first: it shows them on its fields.
- **A change asked for with something missing** ("assign a task to Bode"): the one question for the
  first thing missing, with its answers to tap; the next answer carries on from the conversation.
  Each is asked once in a run: an answer the model could not use leaves the gap on the card rather
  than asking again, and after six questions in a row the card is drawn as it stands. Typing an
  answer works as a tap does; a new question leaves the gathering.
- **A name that matches several people**: "Which Tunde?", each one a choice by name and job title,
  never one picked by the model; found through `colleagues.list` by anyone, or `employees.list`
  where the person holds People.
- **No due day, nobody else at a meeting**: No Due Day and Just Me are answers (null, an empty
  list); the card is drawn without them.
- **A task shared with people and a department at once**: the card shows "People or a department" on
  Department, and Edit clears either before the press.
- **A card's watchers or attendees**: named on the card, never counted on its verb; the task's
  watchers may open it once it is made (`workspace.md` §6).
- **A table the model named without names** (the register's rows hold their person as
  `employee`): the server puts each row's person first, so "who is not in" lists who; an answer
  kept before this drew its table without them, and its Table in the pane draws them (§6.12).
- **The person replies to a question with a question** ("Do you need to know how urgent it
  is?"): the answer says why and asks again, with the same answers to tap.
- **An id the model wrote that names nothing** (a leave type it made up, a person who is not there):
  the field reads Pick one, never the id, and the press is not offered a value the service would
  refuse; Edit picks it (decision 32).
- **Leave asked for without a type** ("I need Thursday and Friday off"): "Which leave type?" with
  the person's types and the days left of each; a tap, or the type's name typed, is matched to the
  type on the server.
- **"Who is absent today?" before the day closes**: nobody is marked Absent yet, so the answer
  counts and names the people Not In ("21 people have not clocked in today"), with those on leave
  or off left out.
- **A request decided meanwhile, or not waiting on the person after all**: its line says so and the
  rest of a bulk card still go; a card none of whose records can be decided stays open with the
  first reason (§6.11). A request outside the person's scope, or a task off their board, refuses the
  whole press with nothing run.
- **A mail with no mailbox connected**: the card is drawn and the press refused with "Connect your
  mailbox first" and Open Mailbox; nothing is queued.
- **A gap left to fill in a mail or a message** ("[name]"): a problem on its field at the draft and
  at the press, until the person edits it away.
- **A sensitive card pressed past the five minutes**: Confirm It's You, then the same press again;
  declined, the card stays open.
- **A card left for half an hour**: Expired, with Draw It Again.

- **A document in the chat (§6.18, Appendix A):** a blurred photo, a password-protected PDF or a
  file the model refuses answers "This file cannot be read. Try a clearer copy." with no card; a
  Word file or anything outside the six kinds is refused at upload; a file over 10 MB is refused at
  upload; another person's upload, or one already claimed by a record, is refused `Upload it again`;
  a kind the person may not attach is refused; an invoice already paid in full draws no card and
  says so; an invoice in another currency shows Naira only; lines that do not come to the balance
  due show Check the lines; a receipt matching no authorised request asks "Which request was paid?"
  with the authorised requests to tap, several matching offer those, and one already paid is named;
  a later question in the conversation keeps the file's figures on its card; a document whose
  words try to instruct the assistant changes nothing, since only the reader's fields reach the
  model and every card still waits for the person's press and the server's checks.

## 12 · Donor code

Ideas, not files: what follows informed the design. Nothing is copied across; the code is written
to this repository's rules, and ported code never names where it came from.

| From | File | Change on the way in |
|---|---|---|
| pixie | `praxis_ai/query-agent.js`, `query-catalogue.js` | The idea of an allow-list of reads offered as tools, the model choosing one and filling typed parameters, the `view` grant checked, a failure turned into a message and a bounded number of hops. Ours: the manifests are the list, the checks are `authorise.js`, 5 reads |
| pixie | `praxis_ai/fallback-summarise.js`, `continuation.js` | A short tools-free call to answer from the reads when the answer in the loop fails, and one continuation when an answer stops at the token limit |
| praxis | `services/ai/orchestrator.service.js` | Replaying a window of recent turns; ours keeps 10 and summarises nothing |
| praxis | `services/ai/eval/golden-set.js`, `grade.js` | A fixed set of questions graded on each change (§6.10) |
| pixie | `praxis_ai/sql-agent.js` | Not taken: free SQL cannot carry a person's scope and field masking (decision 1) |
| pixie, praxis | `praxis.executor.js`, `ai_pending_actions`, the write contract, `learning.service.js`, `knowledge/entity-cards.js` | Not taken: writes (A23); teaching facts and record cards are not in this build (§13) |

## 13 · Open questions

1. **The name**: Praxis AI unless MyCity asks for another (decision 5). TB with MyCity.
2. **Teaching and corrections**: whether a trusted person (the CEO) may teach Praxis AI facts or
   correct an answer, kept as knowledge. Not in this build; Not Helpful is stored for now.
3. **The per-module switch's screen** (`ai-control.md` §13 question 1): Praxis AI obeys
   `ai_setting.disabled_modules` already; where it is set waits on AI Control.
4. **Streaming answers**: answers arrive whole, which suits a weak connection (decision 23:
   progress over realtime instead, built in PR2, §6.1.8). Revisit if answers take more than a few
   seconds on staging once the summaries (PR3) have cut what the model reads.
5. **Extraction** (decision 17): with PR5 shipped, the engine may move into JBS Praxis's own
   repository as packages this project imports, in one PR there, after it. **What moves:**
   `src/services/ai/engine/` whole (turn, cards, pane, content, matrix, errors, index: it requires
   nothing of MyCity, which gate 24 holds), the Assistant group of `packages/ui/src/assistant/`
   (themed by tokens, knowing nothing of the API), the shape of a manifest (`defineManifest`'s
   checks in `shared/ai/manifest.js`, without MyCity's catalogue and route map, which arrive as
   arguments), the matrix generator's contract (`casesFor`, the probe shape), the grading of
   `scripts/ai/eval-assistant.js` and `attack-assistant.js` (`grade`, without the questions, which
   are MyCity's), and the five gates as scripts a project points at its folders (19, 23, 24, the
   matrix and the attack suite). **What stays:** the adapter (`services/ai/assistant/`: the system
   turn, `authorise`, the registry over `src/modules/*/*.ai.js`, the catalogue snapshot), every
   manifest and its probes, the `assistant` and `ai_governance` modules (the card routes, read
   replay, Spend's figures, the attack run's record), the prompt, the evaluation and attack
   questions, the screens in `app/src/features/assistant/`, the migrations and the documents.
   The engine's `createEngine(deps)` and the group's props are the interface the extraction keeps.
   Decided in that repository; nothing here changes until it is.
6. **The job of the action draft** (decision 25): everything runs on Data Answers. If drafting a
   card wants a stronger model, it is one `chain` line on a registered action, chosen by the owner.

## Appendix A · The build plan: documents in the chat (TB, 13/11/2026)

Planned in one chat (decision 48); each PR is built in a **fresh chat** from its start prompt below,
and the planning chat is asked for the next prompt when one merges (CLAUDE.md, Working conventions).
"Most capable, high" means the most capable model the team has, at high effort; no prompt or plan
names a model by its product name in the repository.

| PR | Scope | Lane, owner | Size | Model and effort | Needs merged first | Runs in parallel with |
|---|---|---|---|---|---|---|
| 1 | The attach control and its modal, the contract and the upload purpose, the ask's reading step, the `files` manifest key; Invoice (New Request from an invoice, lines with a negative price, `LinesField`, `MoneyField` `signed`) and Payment Receipt (Record Disbursement from a receipt) | Full stack, TB (Expenses' code reviewed by AJ) | L | Most capable, high | this plan's docs PR | nothing |
| 2 | Contract or MoU: the reading, the summary on the answer and the Record tab, Record Signed Copy and Add Partner Document as cards | Full stack, TB (Partnerships' code reviewed by GE) | M | Most capable, high | PR 1 | nothing |

**Merge order:** PR 1, then PR 2. They never run in parallel: PR 2 adds a kind to what PR 1 builds
(the modal, the contract, the reading step, the manifest's `files`).

Every PR follows CLAUDE.md steps 1 to 5: the type stated, the reading done, contract first, the
rules never broken, `npm run ci` green, `docs/PROGRESS.md` with a dated note under Praxis AI (and
under Expenses or Partnerships for their cards), this guide, `expenses.md` or `partnerships.md`,
the User Guide chapters with their pictures, and `README.MD` matching, the handoff
`docs/handoff/praxis-ai-engine.md` logged. Branches are `m10/<short-name>`; titles are Conventional
Commits.

### PR 1 · The attach control, invoices and payment receipts (`m10/chat-documents`)

- **Contract first:** `AiAttachmentKind`, `AiAttachment`, `AiAsk.attachment`, `AiAttachmentKinds`,
  `AiAnswer.attachment` (assistant.js); `ExpenseInvoiceRead` and `ExpenseInvoiceSuggestion` widened,
  `ExpenseRequestFromInvoice` (expenses.js); `DisbursementReceiptRead` (disbursements.js); the card
  field kind `lines` (`AiCardField`); each with its `TABLES`; `npm run gen:contract`.
- **Backend:** the upload purpose `ai_attachment` and `FILE_TYPES` with HEIC and HEIF; `GET
  /ai/attachment-kinds`; the ask's reading step (§6.18 steps 1 to 5) and `ai_message.metadata.attachment`;
  the manifest key `files` (`defineManifest`, the registry's `filesFor`, gate 19 and gate 23 rule 7
  taught it); the readers (Read Invoice widened; `disbursement-receipt-read` registered in
  `services/ai/actions.js` on Image Reading, `chosen_by: "TB"`, its prompt in
  `services/ai/prompts/`); the overlay in `draftCard`; `my_expenses.from_invoice`; Record
  Disbursement's card carrying the receipt; the request match in the disbursements service; a
  negative line and `EXPENSE_TOTAL_NOT_POSITIVE` in the expenses service; the duplicate sentence.
- **Frontend:** Attach Document beside the question box (desktop and the phone's chat), the modal
  of §10, the file chip on the question's bubble, `LinesField` and `MoneyField` `signed` in
  `packages/ui` (gallery pages, tests, `docs/COMPONENTS.md`), the card's `lines` kind, New
  Request's form taking a negative line and the bank from Read Invoice; the in-browser mock in
  contract shapes.
- **Tests:** unit (the overlay, the lines with paid to date, the match, the manifest's `files`),
  integration on the real migrations (JBS's sample invoice read by a stubbed reader into a request
  of ₦150,000.00 in six lines with its invoice claimed; a receipt matched to one authorised request
  and recorded after Confirm It's You; a kind refused to someone without its grant; another
  person's upload refused), frontend (the modal's three tiles, a Word file refused, the chip, the
  lines on the card), evaluation cases with `file:` samples (a made-up invoice and receipt of the sample's shape under
  `scripts/ai/samples/`, never a real document or a real bank account).
- **Docs:** this guide (§6.18 as built, §10, the Change log), `expenses.md` §6.1, §9, §10;
  the User Guide's Praxis AI chapter (a new section, Attach a document) and Expenses' Raise a
  request, their pictures taken.
- Done when the four integration cases pass, `npm run ci` is green, and on staging the sample
  invoice becomes a request of ₦150,000.00 that a line manager can open with its invoice.

### PR 2 · Contracts and MoUs (`m10/chat-contracts`)

- **Contract first:** `contract` in the kinds' list is offered; `AgreementDocumentRead`,
  `AgreementSignedCopyAdd` (agreements.js); `PartnerDocumentAdd` (partners.js).
- **Backend:** `agreement-document-read` registered on Image Reading (`chosen_by: "TB"`) with its
  prompt; the kind in Partnerships' manifest; the summary on the answer and the Record tab's fields;
  the cards `agreements.record_signed_copy` (risk `approval`) and `partner_documents.attach`, each
  through the route's own service; `not_offered` updated; the agreement and partner match.
- **Frontend:** the third tile, the Record tab's terms.
- **Tests:** integration (a signed MoU filed on its agreement in `sent`, sealed; an MoU with no
  agreement filed on its partner; a reader without `partnerships` edit drawn no filing card),
  evaluation cases with a sample MoU.
- **Docs:** this guide, `partnerships.md` §9 and §10, the User Guide's Praxis AI chapter and
  Partnerships' Contracts & MOUs, pictures taken.

### Start prompts

**PR 1** (paste into a new chat on this repository):

> This is a full-stack change to Praxis AI, PR 1 of `docs/guides/praxis-ai.md` Appendix A:
> documents in the chat, with invoices and payment receipts. Read `docs/guides/praxis-ai.md` in
> full, decisions 41 to 48 and §6.18 above all (they are not re-opened), then `docs/guides/expenses.md`,
> then `docs/handoff/praxis-ai-engine.md`, then what CLAUDE.md step 2 asks for a full-stack task.
> Build only PR 1; contract first. If the guide is wrong or silent, change it first in the same PR.
> Finish as CLAUDE.md step 5 says, log the handoff, open the PR ready for review, and merge it once
> GitHub's CI is green.

**PR 2** (once PR 1 has merged):

> This is a full-stack change to Praxis AI, PR 2 of `docs/guides/praxis-ai.md` Appendix A:
> contracts and MoUs in the chat. Read `docs/guides/praxis-ai.md` in full, decisions 41 to 48 and
> §6.18 above all (not re-opened), then `docs/guides/partnerships.md`, then
> `docs/handoff/praxis-ai-engine.md`, then what CLAUDE.md step 2 asks for a full-stack task. Build
> only PR 2, on what PR 1 built. If the guide is wrong or silent, change it first in the same PR.
> Finish as CLAUDE.md step 5 says, log the handoff, open the PR ready for review, and merge it once
> GitHub's CI is green.

## 14 · Change log

- 13/11/2026 · TB · A record named by its words (`shared/ai/named.js`, decision 32) reads "&" as "and": the model wrote Travel & Transport for the category Travel and Transport, nothing matched, and the New Request card read Category "Invalid uuid" with no New Request button (found filming M8; `docs/runbooks/training-videos.md` §7). Test: `ai-engine.test.js`.

- 13/11/2026 · TB · Documents in the chat, PR 1 built (Appendix A): Attach Document on Ask with Invoice and Payment Receipt, `GET /ai/attachment-kinds`, `AiAsk.attachment`, the reading as read 1 (`file.<kind>`), the manifest's `files`, `my_expenses.from_invoice` with its `lines`, Record Disbursement from a receipt with the request matched in SQL, `LinesField` and `MoneyField` `signed`. The build taught §6.18 five things, written there: the reader's values are laid over the model's before the ask guard and again on later questions of the conversation (a tapped answer keeps the file's figures); an action drawn only from a file says `from_file: { kind, fills }`, offered only with that file and its `fills` counted as asked by gate 23 rule 7, and a new rule 8 holds each kind to a test and an evaluation case; the card names the file on its field rather than as a record, which would count on the verb; a receipt that matches none asks which request (decision 34) rather than leaving Pick one; Expenses' negative line needs migration 8030 (8010's CHECKs on a line's price and amount), and `ExpenseInvoiceRead` gains `subject` and `currency` for the purpose and Naira only.
- 13/11/2026 · TB · Documents in the chat planned (§1.10 decisions 41 to 48, asked of TB with JBS Praxis's invoice INV-202611-9525 as the sample): Attach Document with three kinds picked first (Invoice, Payment Receipt, Contract or MoU), PDF and images only, read on Image Reading, the server setting every figure the file gave, an invoice's balance due itemised, a receipt recording its disbursement, a contract or MoU summarised and filed. The design is §6.18, the screens §2 and §10, the edge cases §11, and the build plan Appendix A (two PRs, each in a fresh chat). Nothing is built yet.
- 13/11/2026 · TB · From New Request on staging ("Expected string, received number" on Quantity and Unit Price, Check the format on Edit's 700000, Quantity drawn as a box of lines): the model's numbers are put in the contract's forms before every card is checked (`cards.shape`, every card, §6.11), the system turn names money and figures as text, a field of figures is a one-line number field and Edit reads an amount as typed. An ask may ask for several fields in one turn (`also`), and an action may offer next steps once pressed (`then`, `AiActionResult.next`), each a button that asks its question (§6.11). Tests: `ai-engine.test.js`, `ai-actions-expenses.test.js`, `ActionCard.test.tsx`.
- 11/11/2026 · JP · Faults of the 11/11 staging brief. #1 and #8 (`VALIDATION: owner_id`, `VALIDATION: department_id` at `POST /ai/cards/:id/confirm`): a card drawn with a problem on a field (Pick one where the model's words matched none of the person's records) still offered its verb, and the press was refused by the re-check. `ActionCard` now offers no verb while a field shows a problem, Edit in its place as the primary button, until Save Changes clears it (decision 34, §10, the Praxis AI chapter). New Vacancy's card asks and matches its hiring manager from `vacancies.hiring_managers` and picks it with the new `AiCardPicks` value `hiring_manager` (§6.11; `recruitment.md` §9, fault #3). Already fixed: #5 by #67 (decision 34), #6 by #64, #7 by #63.
- 07/11/2026 · AJ · M7 PR 5 (`partnerships.md` §9, §13.2 In PR 5): the Workspace cards (Create Task, Save Task,
  Create Project, Save Project, Create Event, Save Event) carry Connect to Partner's optional `partner_id` or `lead_id`
  and `deal_id`, picked on Edit with three new `AiCardPicks` (`partner`, `lead`, `partner_deal`), named by number and
  name and found from words among the records the person sees (`partners.work.card`); the press checks the link as the
  form's own save does. No action was added or taken away.
- 03/11/2026 · JP · The evaluation set run on staging with the real model (100 card questions, 9
  asking ones) and what it found. Fixed: an action the person may make, called as though it were a
  read, was answered "not available" and the model told the person so (Save Targets); it is now
  answered as a change to draft (§6.3, `is_an_action`). Create Task "for me" names the person by
  their own name or "me", and a task card's names read ids alone (`workspace.md` §9). A figure is
  read as the number in the person's words (`named.quantityOf`, §6.11), and Save Key Result offers
  only the key results it can change. Most failures were the questions, not the product: every
  question was asked as the first holder of a role by email, about records staging does not hold
  (a weekly report task, Lovellyn Ade in a head's team, records only another question would make,
  though the set writes nothing). The set now asks as the holder with the most open tasks and fills
  each question from that person's own records, a card's own question's answers among them, and
  skips what staging cannot fill (§6.10); a failed card says what was wrong and what was written; a
  typed address may wait on Pick one (decision 37).
- 03/11/2026 · JP · Performance's, Staff Community's and Mailbox's forms in the chat (decisions 33
  and 40; `docs/handoff/praxis-ai-engine.md` §6.9): 32 actions (§6.11's table), each the screen's
  own service function. Performance: Set Up Quarter, Save Quarter, Record Goal, Save Goal, Share
  Goal, Share Objective, Set Objective, Save Objective, Set Key Result, Save Key Result, Request To
  Unbind, Change Target, Set KPI, Save KPI, Open Round, Save Score and Start PIP and Save PIP
  (risk `approval`), Save Check-In (a line of the monthly check-in), Draft Scorecard, Add Line,
  Save Line, Change Reviewer; Staff Community: Publish Announcement, Save Announcement (the new
  `announcements.ai.js` replaces the module's `ai:none`), Create Channel, Save Channel, Post
  Recognition, Send Wishes, Save Message; Mailbox: Save My Signature, Configure Signature. An edit
  form's card names its record (`PeriodChange`, `OrganisationalGoalChange`, `GoalShareChange`,
  `ObjectiveShareChange`, `ObjectiveChange`, `KeyResultChange`, `KpiChange`, `PipChange`,
  `ScorecardChange`, `ScorecardLineChange`, `AnnouncementChange`, `ChannelChange`, `MessageChange`,
  `SignatureConfigChange`), and so does a create form on its record's page (`PlanUnbindRequest`,
  `WishSend`) or one a card cannot draw as it stands (`AnnouncementPost`, `ScorecardDraft`,
  `CheckInLineChange`, `ReviewScoreChange`, `ScorecardLineAdd`, `PipStart`); a record is named by its
  words among the person's own. An action may name `capabilities` beside `capability`, a list held
  by any one of its codes, as `requireAnyCapability` holds a route (§6.11, §8). The goals module's
  paragraph of "no action" goes. The matrix probes `scorecards.create` and Staff Community's four
  new cards (§6.17). 31 forms off `scripts/check/ai-forms-gaps.json`. Every one of the 32 asks what
  it needs before it is drawn (decision 34, gate 23 rule 7): its record, with the person's own to
  tap (`options` from the module's service, `read` for colleagues, channels and departments), and
  the fields a state needs (`when`); `named.choiceWords` fits a record's words in an answer. §1.9,
  §6.11, §6.17, §8.
- 03/11/2026 · JP · People, Queries & Sanctions and Knowledge Hub · Policies in the chat (decision 33;
  decisions 36 to 39, JBS Praxis, §1.8; `docs/handoff/praxis-ai-engine.md` §6.9): 25 actions
  (§6.11's table), each the screen's own function: Approve Overtime, Add Work Site, Add Type and
  Save Type, Record Leave, Add Employee and Save Record (the work record alone), Save Line, Add
  Department and Save Department, Add Role and Save Role, Add Worksite and Save Worksite, Raise
  Query (signed with the saved signature), Send Response, Save Rule (New and Edit), Add Step and
  Save Step, Add Letter and Save Letter, Start Policy and Save Draft. A place on a card is picked
  (`PlaceToken`, the `place` pick, AddressField; our search signs only one match); the `employee`,
  `worksite`, `policy` and `site_member` picks; a picked field reads as an id whatever its type;
  `allows` passes a letter's own {{ names }} beside the ready-to-send guard, which never reads a
  picked field as words; Draw Signature answers `NO_SIGNATURE`; Letter Templates opens Edit
  Signature from `?action=signature`. Save Letter Signature is never in the chat (`file:`). The
  matrix probes four more (§6.17). Every card asks what it needs first (decision 34): whose record
  from People's register, which department, open role, worksite or policy from its list read, which
  rule, step, letter, leave type or open query of one's own to tap. 26 forms off
  `scripts/check/ai-forms-gaps.json` (31 left). §1.8, §6.11, §6.17, §8.
- 03/11/2026 · JP · Home and Settings in the chat (decisions 33 and 35; "go ahead with Home and
  Settings", JBS Praxis): eighteen cards (§6.11's table), each the screen's own service function: the
  organisation's details (never its address), a holiday added and changed, one working day, a
  numbering scheme; a person's own notice settings, quiet hours and digest; the company's notice rules
  and reminders; System Health's targets, a fault's status and a note; Home's alert rules (made and
  changed) and reports (built, renamed and scheduled). A card changing part of something saved whole
  lays its change over what is saved and holds it to the form's own schema (`shared/ai/change.js`). An
  action may take `view` with a capability, mirroring a route that asks only those (alert rules,
  reports). Decision 35: a structure designed with the whole of it in view is never in the chat,
  `design` (a role's grants, an approval flow and its steps, a role's Home cards); a browser's push
  subscription is `device`. 22 forms off the gaps list (57 left). §1.7, §6.11.
- 03/11/2026 · JP · A card is drawn whole (§1.6 decision 34, JBS Praxis, after a task shared with a
  department was drawn without its lead and refused with Pick a lead): every field an action's input
  requires is asked before its card is drawn, gate 23 rule 7 (§6.15) holding it; an ask takes
  `when` (asked only while another field holds a value: Create Task and Save Task ask "Who leads
  it?" when shared with a department, with that department's people to tap, a lead written by name
  matched among them) and `read` (a field naming a record: its answers are the person's own records
  from that list read, and a value written by its words is matched among them); `options` is handed
  the drafted values and the action's scope; `resolve` matches a list one by one. Every action asks
  what it needs: which task, step, project, event, request, channel or reason, a message's words, a
  mail's address and subject, leave's first and last day, a decision. §6.11, §6.15.
- 03/11/2026 · JP · My Workspace's forms in the chat (decision 33; "go ahead with Workspace and
  Calendar", JBS Praxis; `docs/handoff/praxis-ai-engine.md` §6.9): ten actions (§6.11's table),
  each the screen's own service function: Save Task (`tasks.edit`), Add Step, Save Step, Add Link
  (a task waits on another), Add Reason and Switch Reason (Late Reasons), Create Project, Save
  Project (its Complete and Reopen too), Save Event (`calendar.edit`) and Save Support Needed
  (`week.support`, My Week's manifest, `workspace.ai.js`). An edit form's card names its record
  (`TaskChange`, `TaskStepAdd`, `TaskStepChange`, `TaskWaitOn`, `LateReasonSwitch`, `ProjectChange`,
  `CalendarEventChange`: the form's own schema with the record's id, named for its verb so it is no
  new form) and lists only what changes; the forms' own schemas are reached `via` their actions.
  An action may name a `capability` held on top of its grant, as its route's `requireCapability`
  does: offered only to its holders, refused to anyone else (§8). `resolve` is handed the card's
  values, so a step is matched by its words within its task; a late reason by its words; a week
  by any day in it or this, next or last week. The `task` pick (Wait On Task's list). `tasks.get`
  (§6.9) reads one task as its panel shows it. Ten forms off `scripts/check/ai-forms-gaps.json`
  (79 left). §6.9, §6.11, §6.17, §8.
- 03/11/2026 · JP · Every form in the chat (§1.5 decision 33, JBS Praxis; `docs/handoff/praxis-ai-engine.md`
  §6.9): gate 23 rule 6 (§6.15) holds each create and edit schema of a built module to an action, a
  `via` another action's card, a never word (`secret`, `device`, `personal`, `file`, `ai`), or the
  list of today's gaps (`scripts/check/ai-forms-gaps.json`), which only shrinks. The never forms say
  so: a punch and a check-in (`device`), a home location and a person's own profile (`personal`), an
  import and a document request (`file`), the integrations' keys and the security policy (`secret`),
  a card's own edit (`ai`); the chat box's message, a new direct conversation, a task's panel comment
  and a mail draft are reached `via` their actions. No action was added.
- 03/11/2026 · JP · Decision 32 finished (`docs/handoff/praxis-ai-engine.md` §6.8), after a Request
  Leave card on staging read "Annual Leave" with Pick one: the model wrote "Annual Leave" and the
  type is named Annual, which the match missed. A type now matches with or without the word Leave and
  by a name either side begins; a card with a problem keeps what was matched; an id field reads only
  as a name the card knows (§6.11). The pane follows the latest answer that read records or has
  figures, and a card drawn from what was said no longer leaves it blank (§10.1).
- 03/11/2026 · JP · A card never shows an id (§1.4 decision 32, JBS Praxis; `docs/handoff/praxis-ai-engine.md`
  §6.8), after a Request Leave card on staging showed its leave type as an id marked Not offered.
  `authorise.checkAction` marks a field with `picks` whose id nothing names Pick one, at the draft and
  at Save Changes, and the card never prints an id; manifests take `resolve` (a field the model may
  write by name) and asks take `options` (answers read from the person's own records, filled by
  `answer.withOptions`); `AiCardPicks` gains `leave_type`. Request Leave names its leave type, picks it
  with Request Leave's own list (`LeaveTypeSelect`), matches a type the model writes by name, and asks
  "Which leave type?" with the person's types and the days left of each (§6.11). Prompt version 9:
  a leave type by its name.
- 02/11/2026 · JP · Answers that read well, from JBS Praxis's questions on staging ("What are the
  names?", "Why is there always Open Figures?"; `docs/handoff/praxis-ai-engine.md` §6.7). A table
  names its records: a field may reach into a row (`employee.display_name`), a record reads as its
  name, a list as one cell, and the row's name is put first when no column says who (§6.4); codes
  read as their words (Not In, Remote); the Table pane draws by the same rules (§6.12). A question
  for a card always has its answers to tap: the server fills an ask's choices from the action's
  `asks` when the model gave none (§6.4). The model writes words, never codes, and answers "who is
  absent" in the person's sense, counting Not In (§6.2; prompt version 8). On screen: Open Figures
  only under an answer with a table or figures, a question shows its words and its answers alone,
  and a conversation opened from Recent or History shows its latest answer's pane (§10).
- 02/11/2026 · JP · A summaries test made independent of the day (nothing changed in the engine): its task due "later" is due a week on, since five days on fell inside this week from a Monday or a Tuesday and read Due This Week (`tests/integration/ai-summaries.test.js`; it failed on Monday 02/11/2026).
- 01/11/2026 · JP · Seamless tasks and meetings (§1.3 decisions 28 to 31, JBS Praxis; `docs/handoff/praxis-ai-engine.md` §6.6), after a task card on staging read codes for names, "employee" for whom it was for, and a problem Edit could not clear. A change missing what its action must have is asked for first, one question at a time with answers to tap (`AiAnswerDraft.ask`, `AiAnswer.choices`, kept in `metadata.ask`; a tap is the next question): a task's title, due day and priority, a meeting's subject, day and start, length and who comes, and which person when a name matches several; the server holds the same list (`asks` on an action, `answer.askFirst`, the engine's `cards.nextAsk`: once each in a run, six at most), and the prompt is version 7. A card carries its form's fields alone (`fields`), names what they hold (`names`, migration `10360`, §4) apart from the records a press acts on, so the verb counts no person named, and Edit picks people, departments and projects with the screen's own pickers (`picks`, `AiCardField.picks`). `tasks.create` names everyone on it and takes watchers (people or a department; watching gives sight, `workspace.md` §6), its share rule in its description; `calendar.create` names its attendees instead of counting them. `colleagues.list` (§6.9) lets anyone name a colleague. §2, §4, §5, §6.1, §6.4, §6.9, §6.10 (the `ask` grade and three cases), §6.11, §10, §11.
- 01/11/2026 · JP · Praxis AI Engine PR5, proof and switch-over (`docs/handoff/praxis-ai-engine.md` §6.5; decisions 26 and 27): §6.17 written. The matrix gains scope probes (`matrix: { inside, outside }` beside the scoped reads and actions of Workspace, People, Home, ESS, approvals and Staff Community; each role a report, the suite an outsider; a read returns the inside record and never the outside one, a card naming the outside one is refused by the server's check). The attack suite: `scripts/ai/attack-assistant.js` names eleven attacks and grades the real model's answers (a leak against a catch), `tests/integration/ai-attacks.test.js` runs each with the model scripted on every PR, and `.github/workflows/ai-nightly.yml` asks them of the real model on staging every night through `deploy-gate attack`, recording the run on `ai_attack_run` (migration `10350`, §4) through AI Control's service; AI Control · Spend shows Reads Refused, Presses Refused and the nightly's last result, and a leak is an urgent notice to whoever may change AI Control (`ai-control.md` §7, §10). A press refused for want of rights is `assistant.action_refused` (§7). Gate 23's Create rule is universal (§6.15): every module whose contract exports a Create schema offers it, lists it in `not_offered` or opted out whole; thirteen manifests gained their reasons. The old Ask retired (decision 27): the floating button opens the one full-screen Praxis AI with the screen underneath as `from` (§2, §3 step 8, §10); `AskPanel` and its test are gone. §13 item 5 says what an extraction would move and what stays. Found on the way: `policies.read` returned a list for one record and had been refused by the read guard since it shipped (`policies.md`); the bulk lists' limit now reads At most 25 on a card.
- 01/11/2026 · JP · Praxis AI Engine PR4, action cards (`docs/handoff/praxis-ai-engine.md` §6.4; decisions 10, 11, 19, 20, 21): ten actions declared beside their modules' reads (§6.11's table: `tasks.complete`, `tasks.comment`, `calendar.create`, `my_leave.request`, `leave.approve`, `leave.reject`, `approvals.decide`, `community.message`, `community.post`, `mail.send`, the mailbox gaining a manifest with no read), each the screen's own service function, a bulk one a line per record; goals declares none and says why; every other Create schema `not_offered`. `records(values, actor, db)` names a card's records through the module's own repo at the draft and the press (`authorise.checkAction` takes a database handle); every text a card carries is held to ready to send as Write With AI is (`answer.gapsIn`, "Fill the gap"); `AiCardField.long`; prompt version 6 (the whole text, nothing invented, no sign-off; only requests waiting on the person; a suggested card as a question). On screen (§2, §10): `ActionCard` and `ResultLine` in the Assistant group, wired by `app/src/features/assistant/Card.tsx` on the full screen and in the phone's chat (`shows: ["cards", "pane"]`); Edit through the form system from the action's schema by its name; Confirm It's You before a sensitive card, a passkey first (`useFreshSignIn` reordered, `identity.md` §10), Set Passkey offered once; Draw It Again; a suggested card as a question with Not Now; Open Mailbox on `NO_MAILBOX`. Gate 23 counts an input offered by any manifest (ESS offers leave's own request). Tests: the matrix covers the actions; `tests/integration/ai-actions-{workspace,leave,approvals,community,mailbox}.test.js` on the real migrations (four leave requests approved with a passkey and two rejected with a PIN, self-approval and a record outside scope refused, Tell Ada sent with one press, a mail queued with the signature baked and refused without a mailbox, a gap held on its field); the attack scaffold extended in `ai-cards.test.js`; the evaluation set's action cases, one per action, and a change the person may not make. §8, §11.

- 01/11/2026 · JP · Praxis AI Engine PR3, large data and Excel (`docs/handoff/praxis-ai-engine.md` §6.3; decisions 14 and 15): eight summary reads declared beside their modules' reads (§6.13 table: attendance, tasks, leave, approvals, performance, reviews, employees, the Audit Log, which drops its `ai:none`), each one SQL with the reader's scope, 20 groups, 10 in a top list, 60 points, never a row, shaped through `shared/ai/summary.js`; every read and summary runs inside its own transaction with a 3 second statement timeout and a 4 second deadline (§6.3 step 8, `authorise.guarded`), a read the database cuts is `timed_out` (migration `10340`, §4; `AiReadMade.outcome`) and the model is told "too much"; the summary cache in Redis, 60 seconds, never across people; Overview drawn from the summary with a title check against every value the summary holds, prompt version 5; Download Excel through the one export path with About This File and a 25,000-row cap (§5, §6.16, §7); the evaluation set's summary questions (§6.10). Found on the way: a read whose service runs on the pool cannot be reached by `SET LOCAL`, so the deadline is held in the guard as well; the attendance seed does not reach the test database, so the suite inserts its own days.
- 01/11/2026 · JP · The Praxis AI Engine PR2 (`docs/handoff/praxis-ai-engine.md` §6.2): the full-screen Praxis AI (decision 12) and its pane (decision 13), progress over realtime (decision 23). §2, §3 steps 2 and 3, §6.1.8, §5 (`POST /ask` sends `context` and `shows: ["pane"]`; `AiReadMade.masked`, `AiAnswerTable.read`), §7 (`ai:progress`), §10 both tables. On desktop the conversation sits beside the pane (about two fifths and three fifths) with Back to the screen it was opened from (its address travels as `from`, read as the question's context and as where Back goes; Escape and the browser's Back do the same; from the menu, ⌘K or History, Back goes to History), Recent behind a toggle, and the Praxis AI button on every screen's top bar; on a phone opened from a screen the conversation fills the page and Open Figures opens the pane as a sheet, and the floating button's chat sends the screen underneath as context. The pane: Overview (empty until PR3's summaries), Table (the answer's read run again, 25 a page, up to 200 rows; Download Excel waits on PR3), Record (a row or the one record, Open Record), Sources (every read with its filters, rows, outcome and masks). The React views are the Assistant group in `packages/ui` (AssistantShell, AnswerBubble, SourceChip, PaneTabs, OverviewPane, TablePane, RecordPane, SourcesPane, ProgressLine, PaneSheet). The card's slot waits on PR4. The old Ask's tests moved onto the new screen; the User Guide chapter rewritten with its pictures retaken.
- 01/11/2026 · JP · The Praxis AI Engine (the handover of 01/11/2026, checked and resolved in `docs/handoff/praxis-ai-engine.md`): decision 3 replaced by §1.2's decisions 10 to 27 (the AI acts through declared actions a person confirms; the five-minute Confirm It's You for sensitive classes; full screen with Back; the four-tab pane; pages stay 25 with summary reads; Excel through the export path; the engine as a gated boundary; three tables added; mail and messages as actions; suggested cards; gate 23; no streaming; one AI action). PR1 built: §4 (10330), §5 (the card routes and read replay), §6.11 to §6.15, §7, §9, §13. PR2 to PR5 and their prompts are in the handoff. On the way: the phone list's No Conversations Yet is a second-level heading, as Ask's empty conversation already was (the accessibility gate refused h1 straight to h3); nothing on screen changes.
- 26/10/2026 · JP · From the User Guide audit's screen defects: an unexpected failure answers `AI_FAILED` as §5 says (it was the generic 500); a 500 shows its reference; AI off and an unusable answer put the words back in the box (no Try Again); Send waits on an answer still coming; the microphone gives the server's reason; Helpful on, or Delete of, a conversation deleted elsewhere says so (§10, §11).
- 26/10/2026 · JP · §6.9: the User Guide's `guide.search` read, so a how-to question is answered from the guide, cut to the asker's grants (`user-guide.md` §9).
- 25/10/2026 · JP · Ask's empty conversation (Try Asking, Ask a Question) is a second-level heading (`EmptyState` `level={2}`): on a phone it sits straight under the page title, and the accessibility gate refused h1 straight to h3. Nothing on screen changes.
- 23/10/2026 · GE · Ask on a phone works like a chat app, after review on a phone: it opens on the person's conversations with New Conversation, and a conversation, or a new one, opens full screen and Back returns to the list, as the floating button's panel already did. Inside the chat, in both, Conversations opens the other conversations as a sheet, the way Staff Community switches channels inside a channel, beside New Conversation (`PhoneChat.tsx`). §3 step 8, §2 and both §10 tables. Desktop is unchanged.
- 23/10/2026 · JP · §6.4: "book a meeting" fills New Event's attendees, named by the person and found through the colleague card (`CalendarEventPrefill.attendee_ids`); "start a project" opens New Project filled (`ProjectPrefill`, `docs/guides/workspace.md` §9).
- 22/10/2026 · GE · History brought to the demo and From to the kinds of record, after review of the merged screens: decision 7 amended (AI Control holders see the company's figures on History: questions this month, Praxis AI's spend, the cap, spend per month, questions by module; counts and naira only) and decision 9 added (From names record types with counts; a record is named only when the answer rests on that one; table rows open their records). §2, §4, §5 (`GET /history/questions`, `POST /history/export`, the summary's two views), §6.4 (`sources`, the table's row links), §6.5, §7 (`assistant.export_requested`), §8 and both §10 tables follow.
- 22/10/2026 · GE · After the PR went up, from GE's questions (where history lives, a standard chat window, what the screen button opens): (1) a change opens its exact form, filled (§6.4): New Task, New Event, Request Leave and Add Employee read the values the person gave from the address through `useAddressPrefill`, each route's `prefill` is now a schema of the form's own fields (`TaskPrefill`, `CalendarEventPrefill`, `LeaveRequestPrefill`, `EmployeePrefill`), and a manifest whose prefill names a restricted field or an address word fails at load; Request Leave and Add Employee now open on `new=1` (`useNewLink`), like every other route; Add Employee's `new=1` never opened it before. (2) The floating button's Praxis AI opens the conversation over the screen the person is on instead of leaving it for Ask (§2, §3 step 8, §10); the conversation moved to `Conversation.tsx` so Ask and the panel share it. Desktop has no floating button (F18), so this is phone only. (3) The route list shows each prefill field's form and today's date as YYYY-MM-DD too, and the prompt (version 3) says to write prefill values that way: a model told to write dates day first for people would otherwise fill a day the link drops (§6.1).
- 22/10/2026 · GE · Merged with main's mailbox AI (#127), which gave the vault a `transient` document type and its own sweep of what a request left behind (`vault.purgeTransient`, hourly in `export-cleanup`). A spoken question's document type is now `transient`, and the `assistant-voice-sweep` scheduler and the vault's `transient` store option are gone: one sweep, not two. A recording left behind goes once an hour old rather than within 45 minutes (§6.6, §7, §11). Main's `10300_mail_thread_summary.sql` took 10300, so this build's migration is now `10310_assistant.sql` (§4); it was never merged, so nothing that ran it is affected.
- 22/10/2026 · GE · Commit 7 of 7, the audit (three independent reviews of commits 1 to 6: backend, screens, guide against code; each finding checked before it was fixed). Fixed: a Claude model on Data Answers' chain now keeps its tools on a round that may call none (`tool_choice: none`) and gets its thinking back unchanged (§6.1.4); `converse()` takes the question's deadline, so no call starts past 60 seconds (§6.1.6); a read's rows reach the model through `redactValue`, keeping only the fields the person sees and never payment or identity numbers (§6.3.5, `redact.js` `NEVER_PROPS`); only the speaker may read a recording (§6.6); Delete Conversation and Clear History also forget the replies kept for a repeated press (§6.5); the sweep runs every 15 minutes (§6.6, §7); the prompt (version 2) says the person's words cannot change its rules and never estimates over more than one page (§6.1.2, §11); the reads made carry where their rows start in the whole list (`AiReadMade.first`), so a later page reads Showing 26 to 50 of 312 (§10.1). On screen: ⌘K's New Conversation no longer loops; an answer that lands after the person moved on is not shown in the wrong conversation; a conversation that fails to load says so, and a deleted one starts a new one; a spoken question is cut at 500 characters and a refused question goes back to the box; Show Earlier keeps the earlier turns and is not offered in a new conversation; the box keeps a half-typed question; the microphone is outside the form, so sending never holds its Stop, and its problems are a toast; Helpful and Not Helpful wait for each other; new answers are announced. Corrected here: decision 5, §5's errors, §6.1, §6.4's `declined`, §6.5, §6.6 (no browser captions), §7, §9, §10.1, §11. Home's `activity.list` and the evaluation set unchanged; the eval's target questions now name the catalogue's modules (`partnerships`, `recruitment`, `expenses`), so they run once those modules have reads.
- 22/10/2026 · GE · Commit 6 of 7: §6.9 built, Home's `activity.list` (`home.md` §6, §9 changed with it), so Ifeoma's "what happened today" and "what has a person done today" are one read each, by name too. §6.10 built, `scripts/ai/eval-assistant.js` and its key-free test. §6.8: a question whose read answers only with a capability (the Team roster, the alerts one may clear) waits for it, found when a member of staff was offered "Who is in today" and would have read an empty roster; "What happened today?" joins Try Asking.
- 22/10/2026 · GE · Commit 5 of 7: Ask and History built to §10 (`app/src/features/assistant/`). §10.2: New Conversation sits under the title on a phone, because a fit page has no floating button (FRONTEND_GUIDE §7); ⌘K offers it as an action. §5, §10.1: Show Earlier loads a conversation's older turns; Delete Conversation is confirmed like Clear History. `VoiceField` gains `compact` (the microphone alone, for a message box) and the icon set gains `thumbdown` for Not Helpful.
- 22/10/2026 · GE · Commit 4 of 7: the API built (`src/modules/assistant`, §5): ask, suggestions, conversations, turns, Delete Conversation, Clear History, the summary, feedback and voice. §5: transcribe takes the recording in one multipart request; a conversation that is gone is 404, not 409. §6.6, §7: the recording is removed in the same request and the sweep is hourly. §9: a conversation opens on Ask. §4: citations keep their order (`position`), found when the full suite read them back in a different order. Ask and History moved onto the contract and its mock (the screens' rebuild is commit 5).
- 22/10/2026 · GE · Commit 3 of 7: §6.1 to §6.4 built as the engine (`services/ai/assistant/{orchestrator, answer}.js`); the prompt is `prompts/data-answers.md`, named after its action as the AI-actions gate requires.
- 22/10/2026 · GE · Commit 2 of 7: §6.7 built: tools on every text model's vendor file, `converse()`, Voice Question registered (built with the API, commit 4).
- 22/10/2026 · GE · Commit 1 of 7: the contract (`assistant.js`) and migration `10300_assistant.sql` built. §4: `ai_message` gains `rows_read` and `module_key` as columns (History reports on them), the role CHECK keeps the three roles `10099` seeds, and the 10000 tables gain their indexes and update triggers; numbered 10300, after AI Control's 10200 to 10220, so no server applies it out of order. §5: `ai_conversation_id`, the column's name.
- 22/10/2026 · GE · §6.7: no Cannot Use Tools state. Every provider's vendor file takes tools, so any text model on Data Answers' chain answers, first choice or fallback, as AI Control promises (`ai-control.md` decision 34 rewritten).
- 21/10/2026 · GE · Written from the decisions of 21/10/2026 (§1.1), Ifeoma's request at the M1
  handover (21/10/2026) and REUSE_MAP §11: reads through the manifests only, up to 5 a question,
  routes for changes, voice in, History own only, tables from the rows. To be built.
