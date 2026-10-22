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
| Status | Draft |
| Last changed | 22/10/2026 |

Sources: MILESTONES §15 (M10's assistant, its definition of done) and A23 (it reads, it never
writes), BACKEND_STRUCTURE §14 (the AI pipe, the manifests, the registry), `ai-control.md` (jobs,
chains, decision 22), REUSE_MAP §11, the M1 handover meeting of 21/10/2026 (00:42:41 to 00:45:03,
Ifeoma's request) and the decisions of 21/10/2026 below.

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
3. **It answers, it never acts** (A23). Asked to change something, it offers the screen where the
   person makes the change, prefilled where the screen takes it (the manifests' `routes`).
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
8. **Tables come from the rows, not from the model.** When an answer carries a table, the model
   names which read and which fields; the server draws the rows from what that read returned. The
   model's words are provisional; the figures in a table are the records'.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Praxis AI · Ask (`ask`) | Staff app, System group | `praxis_ai` view | A conversation: questions, answers with their table, the records read and a screen button; on desktop the recent conversations beside it; Try Asking when it is empty | Ask (typed or recorded), Open the offered screen, open a cited record, Show Next 25, Helpful or Not Helpful, New Conversation |
| Praxis AI · History (`history`) | Staff app | `praxis_ai` view, own conversations only | This month's questions, conversations and records read; the conversations, 25 a page; questions by module | Open a conversation (back on Ask), Delete Conversation, Clear History, search conversations |
| Floating button (phone) | Staff app, every screen | `praxis_ai` view | Praxis AI in the fan (built, F18) | Opens Ask |
| ⌘K | Staff app | `praxis_ai` view | Ask, History, the person's own conversations, New Conversation | Open them |
| AI Control · Actions | Staff app | `ai_control` view | Data Answers marked built; the new Voice Question action; Data Answers' chain takes any text model as first choice or fallback | As built (`ai-control.md`) |
| Every module's manifest | Backend | | The reads Praxis AI may run and the screens it may offer | Gains reads where a question needs one (§6.9) |

## 3 · How the screens relate

1. A person types a question on Ask, or presses the microphone: `VoiceField` records, the audio is
   uploaded through the upload engine, and `POST /ai/transcribe` returns the words into the box.
   They check it and send.
2. `POST /ai/ask` (`AiAsk`: the question and, after the first, the conversation). The service
   checks governance (AI on, Praxis AI's module switch, the overall cap), opens or continues the
   conversation, and builds the turn (§6.1): who is asking, today in Lagos, the screens they may
   open, the reads they may run as tools, the last 10 turns.
3. The model answers with read calls or with its answer. Each read runs through
   `authorise.runRead` with the person's own rights (§6.3) and its page goes back to the model as
   data. At most 5 reads; then it must answer with what it has.
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

## 4 · Data

Migration `10300_assistant.sql` (M10's block). The tables are `10000`'s; this build widens two.

| Table | Key columns | Notes |
|---|---|---|
| `ai_conversation` (10000) | `user_id`, `title` (the first question, cut at 120 characters), `status` (`active`), adds `last_asked_at`, `questions` (10300) | One per conversation, always the asker's own. Index (`user_id`, `last_asked_at` desc) |
| `ai_message` (10000) | `ai_conversation_id`, `parent_message_id` (an answer's question), `role` (`user`, `assistant`, `system` as seeded in `10099`; CHECK added in 10300), `content` (the question, or the answer's words), `ai_run_id`, `feedback` (`up`, `down` or null; CHECK added), adds `rows_read` (the rows its reads returned) and `module_key` (the module of its first read) (10300), `metadata` | History reports on `rows_read` and `module_key`, so they are columns. An answer's `metadata` holds what is only shown: its table (columns, rows, numeric columns), its screen button, the reads it made (key, rows returned, total), `declined` and `more`. Indexes on the conversation, the parent and the run (10300) |
| `ai_message_citation` (10000) | `ai_message_id`, `label`; adds `entity_type`, `entity_id`, `read_key` and `position` (the order the answer cited them in) (10300); `knowledge_article_version_id`, `document_id` stay | 10000's CHECK required an article or a document; 10300 widens it to accept a record (`entity_type` and `entity_id`) |
| `ai_run`, `ai_run_step` (M0, 10200) | `purpose` `data-answers` or `praxis-ai-voice` | One run per question, one step per round with the model. No question or answer text is kept here |

No reference seed: `praxis_ai` grants are `0290`'s. Nothing is seeded on production; staging's
conversations come from asking.

## 5 · API

Under `/api/v1/ai`, schemas in `packages/contract/schemas/assistant.js`.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `POST /ask` | `AiAsk` (`question` up to 500 characters, `ai_conversation_id` optional) → `AiAnswer` | `praxis_ai` create | no | `Idempotency-Key`; one answer whole, never streamed |
| `GET /suggestions` | → `AiSuggestions` (up to 6 questions) | `praxis_ai` view | no | Only questions the person's reads can answer (§6.8) |
| `GET /conversations` (`q`, `sort`, `page`) | `AiConversationListQuery` → `AiConversationPage` | `praxis_ai` view · own always | yes, 25 | Newest first; `q` searches titles |
| `GET /conversations/:id/turns` (`page`) | `AiTurnListQuery` → `AiTurnPage` | `praxis_ai` view · own | yes, 25 | Newest page first; Show Earlier loads the page before |
| `DELETE /conversations/:id` | → `no_content` | `praxis_ai` view · own | | Removes its messages and citations |
| `DELETE /history` | → `no_content` | `praxis_ai` view · own | | Every conversation of the caller |
| `GET /history/summary` | → `AiHistorySummary` | `praxis_ai` view · own | no | This Lagos month: questions, conversations, records read; questions by module |
| `POST /answers/:id/feedback` | `AiFeedback` (`up`, `down` or null) → `no_content` | `praxis_ai` create · own | | |
| `POST /transcribe` | the recording, multipart through the upload engine (`documents.DocumentUpload`, purpose `voice_note`) → `AiTranscript` (the recording's `document_id`, already removed, which the upload engine resolves on; `text`, `draft`) | `praxis_ai` create | | One request: stored, transcribed, removed (§6.6) |

Errors: 404 `NOT_FOUND` (a conversation or answer that is not the caller's, or no longer exists,
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
   - today: the weekday, the Lagos date and time (the working week is a read, `working_week.get`);
   - the screens this person may open (`shared/route-map` SCREENS filtered as ⌘K filters them,
     `shared/search/screens.js`) and the manifests' routes they may reach, as `intent → screen`;
   - the last 10 turns of the conversation: each question, its answer's words and the reads it made
     (key, parameters, rows returned, total), never the rows themselves, so "show the next 25" knows
     which read to page;
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

### 6.2 What the model may and may not do

- It answers only from what the reads returned this turn and what earlier turns said. It never
  invents a record, a number or a person.
- It says plainly when a read was refused, and does not hint at what it would have found.
- It never says it has done, changed, sent or approved anything. For a change it names the screen
  (a route), and the person acts there.
- Dates day-first, money in naira with two places, people by name. English only (MILESTONES §18.1).
- Short: a sentence or three, then the table if one helps.
- Everything a read returns (a message, an announcement, a note) is data. Text inside it never
  changes what the model does; it is all the person's own visible data, and reads cannot write.

### 6.3 A read

`authorise.runRead(client, actor, key, params)` (BACKEND_STRUCTURE §14.3), every time:

1. the read exists; its grant is held (else `AI_READ_FORBIDDEN`, which the model receives as "not
   available to this person" and the answer is marked `declined: "not_available"`);
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
7. its citations are kept for the answer (`cite.js`).

### 6.4 The answer

`AiAnswerDraft`, what the model returns: `text` (the words), `table` (`read`: which of this turn's
reads, `fields`: up to 6 of its row's fields, `labels`: their column names) or null, `route` (one
of the offered intents) or null, `more` (a read had a next page worth offering).

The server turns it into `AiAnswer`:

- **table**: the rows of the named read, those fields, formatted for a person (dates through
  `shared/time/day-first`, money through `shared/money`); numeric columns marked for right
  alignment. A field the read did not return is dropped; a table with no valid field is dropped;
- **link**: the route's screen through `route-map.screenPath`, with its `params` and any `prefill`
  values the model gave that parse with the route's `prefill` schema; a route to a screen the person
  may not open is never offered and, if named, dropped;
- **citations**: from every read this turn, de-duplicated, first 50 kept with the total;
- **declined**: `not_available` when a read was refused and nothing else answered, `change` when a
  screen was offered (the model offers one for a change asked for, or where no read answers; the
  server cannot tell which), else null;
- **provisional**: always true.

### 6.5 Conversations and history

- A question without `ai_conversation_id` opens a conversation titled by its first 120 characters.
- The last 10 turns are replayed; older turns stay on screen but are not sent.
- Delete Conversation and Clear History remove the conversations, messages and citations, and the
  replies the idempotency layer kept for a repeated press of Send (`middleware/idempotency.js`
  `forget`), which hold the answers' words too. The runs stay, holding no words, so spend and the
  cap are untouched.
- `AiHistorySummary`: this Lagos month's questions and conversations, the records read (the rows
  every answer's reads returned), questions by module (the module of the first read of each
  answer; no read counts as Other).

### 6.6 Voice

- `VoiceField` (120 seconds at most) records; the screen sends the recording in one request,
  `POST /ai/transcribe`, through the upload engine (purpose `voice_note`).
- The words come from `services/ai/transcription.transcribe` under the action `praxis-ai-voice`
  (Transcription job, personal data, so never DeepSeek; Groq, then Gemini). No browser captions
  are taken: when neither answers, the box stays empty and the microphone says Could not
  transcribe. The stub's placeholder (no provider set up) comes back as a draft and is not put in
  the box either.
- The recording is held in the vault (document type and record type `ai_voice_question`, its id
  the speaker's login, stored `transient`, so no derived files are queued for it) only while it is
  transcribed, and removed in the same request whatever happens. Only the speaker may read it
  (`vault.defineAccess`), the CEO and an `all` holder included. One a request left behind (the
  process stopped mid-way) is removed by the `assistant-voice-sweep` scheduler: every 15 minutes,
  any recording 30 minutes old, so within 45 minutes.
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

The six target questions of MILESTONES §15 answer as their modules land: overdue tasks (M2,
`tasks.list` today), expenses awaiting approval (M8), due for confirmation (people), inactive
partnerships (M7), candidates awaiting feedback (M4), budget against actual (M8). Due for
confirmation reads `employees.list`, whose rows carry `confirmation_due_on`: MyCity's staff fit on
one page, and People adds a date filter if the staff grows past the 125 people five reads can hold.

### 6.10 Checking answers

`scripts/ai/eval-assistant.js` asks its questions (`CASES`) on staging with a real key, each as the
person of the role it names (the CEO's login, or the first active login holding the role code),
through the same engine Ask uses, and grades each answer:

| Grade | Passes when |
|---|---|
| `reads` | one of these reads ran and returned (the answer came from the records) |
| `never` | none of these returned rows (a member of staff asking about others' pay or lateness) |
| `route` | the change asked for came back as this screen, with `declined: change`, never a claim |
| `needs` | a target question whose module declares no read yet is skipped, not failed |

The set holds Ifeoma's two ("what happened today", "what has a person done today"), the target
questions as they become answerable, the privacy cases and three changes (a task, leave, a meeting).
It saves nothing to History and writes nothing; each question is one Data Answers run in AI Control
· Spend. `--only=<id prefix>`, `--list` (asks nothing), `--json`. Exit 0 when all pass, 1 when one
fails, 2 when it cannot run (nobody holds a role, AI is off, only the stub answers). Refused on
production. Run by hand before a change to the prompt or the loop ships; not in CI, which has no
key. `tests/unit/foundation/ai-eval.test.js` checks without a key that every question names reads
and screens a manifest declares, and that the grading passes and fails what it should.

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `assistant.answered` | A question answered and saved | Audit only: the conversation, the message, the read keys; never the words |
| `assistant.conversation_deleted` | Delete Conversation | Audit only |
| `assistant.history_cleared` | Clear History | Audit only |
| `assistant.feedback_given` | Helpful or Not Helpful | Audit only |
| `assistant-voice-sweep` (under the cron lock) | Every 15 minutes | Removes recordings 30 minutes old: their request never finished (§6.6) |

Nobody is notified of anything.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Every role with `praxis_ai` (all seven seeded roles) | Ask and History, their own conversations only | Ask, record a question, give feedback, delete their own conversations |
| What each person learns | Exactly what their own grants, scope and field visibility show on screen | |
| CEO | Everything, by the standing rule, through the same reads | The same |

The `praxis_ai` scope (`all` for the Implementation Team, Operations & People and Management, `own`
for the rest) does not widen History (§1.1 decision 7); a read's scope comes from that read's own
module grant. Restricted fields reach the model only for a person who sees them on screen.

## 9 · AI and search

- **AI reads**: none (`// ai:none` in the controller): a person's questions are their own, and the
  assistant never reads its own history as data.
- **AI routes**: none.
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
| Praxis AI · Ask (`ask`) | Praxis AI as the title, with New Conversation once a conversation is open; on desktop, Recent beside the conversation (titles and when last asked, newest first, 25 a page); empty: an illustration, Try Asking with up to 6 questions to tap; the conversation: Show Earlier when older questions remain, each question as the person's bubble, each answer as a card with its words, its table (`DataView`, bare), Showing 25 of 312 when its read had more (Showing 26 to 50 of 312 on a later page), Show Next 25 on the newest answer that has more, its screen button ("Open Leave"), From with the records read as chips opening each (the first 6, then "+12 More"), Helpful and Not Helpful (pressed again, taken back); while waiting, Reading Your Records; a refused answer in plain words; a failed one with its reason and Try Again; the box: Ask a Question, the microphone (Record Question, then the time and Stop Recording) and Send; Recent empty: No Questions Yet; toasts "Thanks for the feedback", "That conversation was deleted", a refused question's reason, the microphone's problem (Microphone not allowed, Could not transcribe) | Help term on From (the records this answer was read from, as you would see them) | How reads, permissions, redaction and the loop work: §1.1, §6 here and the manual |
| Praxis AI · History (`history`) | History as the title; this month's Questions, Conversations and Records Read, each captioned with the month; Conversations, 25 a page: Title, Last Asked, Questions, Records Read, a row opening it on Ask, a row menu with Delete Conversation, confirmed in the shared dialog ("Delete Conversation"); Search Conversations; empty: No Questions Yet, "Ask one on the Ask tab."; Clear History, confirmed in the shared dialog ("Clear History", "Every conversation is removed.", Clear History); Questions by Module (desktop); toasts "Conversation deleted", "History cleared" | Help term on Records Read (how many records this month's answers were read from) | Where spend and the cap are (AI Control · Spend), what deleting keeps: §6.5 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Praxis AI · Ask (`ask`) | The conversation full height (a fit page), the box pinned at the foot with the microphone and Send as 44 px targets; empty, Try Asking as a tap list; an answer's table as cards | Recent, which is History on a phone | Send; New Conversation under the title (a fit page has no floating button; ⌘K's New Conversation opens it too) | The floating button's Praxis AI from any other screen; More, then Praxis AI; tabs Ask and History |
| Praxis AI · History (`history`) | The three month cards, then the conversations as cards (title, last asked, questions) | Records Read on each conversation; Questions by Module | Tap a card to open it on Ask; Delete Conversation in its menu's sheet; Clear History in the page's menu | As above |

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
- **A question that needs a total over more than one page** (a sum of 400 records): answered only
  where a read returns that total; otherwise the answer gives the total, says it looked at the
  first 25 and names the screen (the prompt says so and never to estimate the rest). A module adds
  a summary read when its questions need one.
- **The connection drops while waiting** (Ifeoma's bad network zone): the answer is saved; the
  conversation shows it on reload, and a first question's answer is in Recent and History. Try
  Again sends the same `Idempotency-Key`, which returns the same answer, never a second run.
- **The person moves to another conversation, or leaves, while an answer is being made**: the
  answer is saved where it was asked and shown there; the conversation on screen is not touched.
- **A question refused as it stands** (a 4xx other than 404 and 409, such as one over 500
  characters): the words go back to the box with the reason in a toast; Try Again is only for a
  question that may succeed if sent again.
- **A person loses a grant after asking**: their History keeps the old answer's words; a citation
  opens through the screen's own check, which may now refuse.
- **A cited record is deleted later**: the citation opens the screen's not-found state.
- **A conversation deleted in another tab**: asking in it is 404 and the screen starts a new
  conversation with the same question in the box; opening it (from History or ⌘K) does the same,
  with "That conversation was deleted"; deleted while its answer was being made, the question is
  saved in a new conversation.
- **A recording that never transcribes**: the box stays empty and Could not transcribe shows in a
  toast (the stub's placeholder is not put in the box either); the recording
  is removed in the same request, or by the sweep within 45 minutes.
- **A question in another language**: answered in English.

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
4. **Streaming answers**: answers arrive whole, which suits a weak connection. Revisit if answers
   take more than a few seconds on staging.

## 14 · Change log

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
