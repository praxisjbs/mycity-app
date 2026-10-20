# AI Control · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M10 (brought forward by TB, 20/10/2026) |
| Backend modules | `ai_control` |
| Frontend paths | `app/src/features/ai-control/` |
| Permission key(s) | `ai_control` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | Added when PR2 starts (`npm run new:screen`): Actions, Models, Spend |
| Status | Agreed |
| Last changed | 20/10/2026 |

Sources: TB's answers of 20/10/2026 on AI providers, transcription and AI Control (§1.1, with
`integrations.md` §1.2), MILESTONES §15 (M10: governance, spend caps, model configuration, per-module
AI access) and A23, BACKEND_STRUCTURE §14.

---

## 1 · What it is for

AI Control decides which model answers each AI feature in the ERP, what happens when that model
cannot answer, and what AI costs each month. Settings · Integrations holds the providers' keys and
model lists (`integrations.md`); AI Control chooses among them. It is for the Implementation Team
and the System Administrator, who set it up, and for Operations & People, who watch the spend so
the providers' accounts are recharged before they run out.

It is built in **PR2**, after PR1 has put every provider on Settings · Integrations and made voice
notes transcribe (`integrations.md` §1.2). Until it exists, each job uses the best model its
provider's key can use, in the seeded order.

### 1.1 Decisions (TB, 20/10/2026, binding)

Numbered after `integrations.md` §1.2, which holds 1 to 11.

12. **Its own module under System, beside Praxis AI**, with three tabs: **Actions**, **Models** and
    **Spend**, and its own permission `ai_control`. The Implementation Team and the System
    Administrator edit it; Operations & People view it, so they see the spend and know when to
    recharge. Keys stay on Settings · Integrations; each provider on Models links to its connection
    there, and each AI connection links back.
13. **Seven jobs**: Default, Fast, Deep Reasoning, Image Reading, Transcription, Embeddings and Top
    Tier (§6.2 says what each is for).
14. **Every AI feature is an action, registered in code under a job**: voice note transcription,
    dictation, review cleanup, JD draft, CV screening, proposal draft, image reading, Data Answers,
    Find Prices. A new action appears on the Actions tab by itself.
15. **A chain is a first choice and up to three fallbacks**, each a model from any connected
    provider. An action uses its job's chain unless it is given its own.
16. **Make First.** One press moves a model to the front of its chain, so Top Tier's Gemini and
    Anthropic swap in one press. Top Tier starts with Gemini's Pro model first and Anthropic's
    Sonnet second.
17. **Skip until reset on every chain** (`integrations.md` §1.2 decision 7). Transcription's chain
    ends in the browser's captions.
18. **Embeddings: OpenAI's small embedding model at 1,536 dimensions**, with no fallback (vectors
    from two models cannot be mixed in one index). The pick locks once the first article is
    indexed; changing it after that is a support step that rebuilds the index.
19. **A price per model**, in dollars as the provider publishes it, converted to naira with the
    day's rate from Exchange Rates. Each call records the naira price it was charged at, so a new
    rate never rewrites past spend. Free-plan calls still record their tokens and audio seconds.
20. **Find Prices, confirmed by IT.** The Deep Reasoning model, with Google Search on, reads each
    provider's pricing page and proposes a price for each model with the page it came from. IT
    accepts or edits each before anything is saved (AI output is provisional, A23). Each search is
    billed separately.
21. **A monthly naira cap on each paid provider.** At its cap a provider is skipped for the rest of
    the Lagos month and every action moves down its chain; the overall AI cap stays as the last
    stop. **No warnings and no notifications**: the Spend tab shows where each provider stands.
22. **Data Answers: the model chooses a read, it never writes SQL.** Praxis AI answers a question
    about the data by choosing one of the modules' reads (their `.ai.js` manifests) and filling its
    filters, as BACKEND_STRUCTURE §14.3 and A23 describe. Gemini's Flash model first, its Pro model
    second. **Permissions are checked by code, never by a model**: before any read runs,
    `authorise.js` checks the person's grant, the repo applies their scope, and field masking empties
    restricted fields before the model sees a row. A model asked to judge access could be talked out
    of it by the text it reads.
23. **DeepSeek only where no personal data is sent.** Its API is run from China, so personal data
    sent to it would leave Nigeria. Each action declares whether it carries personal data; AI Control
    offers DeepSeek only on those that do not (Find Prices, summaries of public pages, tagging).
24. **Registry, rules and a check.** Each action is declared once, in a registry file, with its job,
    whether it carries personal data and, for Top Tier, a written reason. §6.2 and a rule in
    CLAUDE.md say which job fits which work. **A build that adds an AI feature asks the person which
    job it uses**, recommendation first, and the registry records who chose it and when. A build check
    fails any AI call that names no registered action, and a Top Tier action without its reason.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| AI Control · Actions (`actions`) | Staff app, System group | `ai_control` view | Each job and its actions, each with its chain (first choice and up to three fallbacks), the state of each model in it, and today's calls | Change a chain, Make First, give an action its own chain or put it back on its job's (edit) |
| AI Control · Models (`models`) | Staff app | `ai_control` view | Every model of every connected provider: what it does, whether this key can use it, its price in dollars and naira, the chains it is in | Find Prices, accept or edit a proposed price (edit); open the provider's connection |
| AI Control · Spend (`spend`) | Staff app | `ai_control` view | This month's spend per provider against its cap, the overall cap, spend by action and by day | Set a provider's monthly cap and the overall cap (edit) |
| Settings · Integrations (`integrations`) | Staff app | `integrations` view | Each AI connection links to AI Control · Models | As built (`integrations.md`) |
| Praxis AI · Ask | Staff app | Everyone with Praxis AI | Data Answers runs on the Default job's chain | As built in M10 |

## 3 · How the screens relate

Planned for PR2; the detail is written when PR2 starts.

1. Settings · Integrations saves a provider's key and reads its model list (`integrations.md` §3).
2. AI Control · Models lists those models; Find Prices proposes their prices, which IT accepts.
3. AI Control · Actions builds each job's chain from those models.
4. A feature's call (`ai.complete()`, `ai.transcribe()`, embeddings) names its action; the chain
   resolver picks the first model in the chain that is not skipped (quota, rate limit, failure,
   provider at its cap) and the ledger records the action, the model and the naira price.
5. AI Control · Spend sums the ledger per provider for the Lagos month against the caps.

## 4 · Data

Planned for PR2. `ai_model` (the model list) and `fx_rate` (the daily rates) are created in PR1
(`integrations.md` §4); PR2 adds the chains, the caps, the proposed prices and the action on each
ledger run, in M10's block.

## 5 · API

Planned for PR2, under `/api/v1/ai-control`, every list paged at 25: the actions with their chains,
a chain's save and Make First, the models, Find Prices and accepting a price, the spend and the caps.

## 6 · Rules and calculations

### 6.1 Choosing the model for a call

1. The action's own chain, else its job's.
2. Walk the chain in order and skip a model whose provider is: not set up; at its daily limit on a
   Free plan; told us its quota is used up and its reset time has not passed; at its monthly cap; or
   DeepSeek for an action that carries personal data.
3. Call the first model left. A refusal for quota or rate limit, a failure or no answer within 30
   seconds moves to the next; a quota refusal also marks the provider skipped until its reset time.
4. The overall monthly AI cap refuses the call once reached, whatever the chain says.

### 6.2 Which job

What a build reads to choose a job. A feature that fits none asks before inventing one.

| Job | For | Starting first choice | Not for |
|---|---|---|---|
| Default | Everyday drafting and tidying: review cleanup (A18), a record's summary, Data Answers | Gemini Flash | Long documents from many sources |
| Fast | Short, cheap and frequent: tagging, titles, a classification | Gemini Flash-Lite | Anything a person reads as a draft |
| Deep Reasoning | Judgement over several inputs: CV screening against a JD (M4), Find Prices | Gemini Pro | Everyday tidying |
| Image Reading | Reading a picture or a scan: receipts, IDs, a photographed form | Gemini Flash | Text only |
| Transcription | Speech to text: voice notes, dictation | Groq Whisper, then Gemini, then the browser | Anything else |
| Embeddings | Vectors for search: the Knowledge Hub (M10) | OpenAI small embedding model, 1,536 | Generating text |
| Top Tier | Long, careful drafting from many sources: proposals and MOUs (M7) | Gemini Pro, then Anthropic Sonnet | Anything Default or Deep Reasoning can do. Needs a written reason |

### 6.3 Prices and spend

- A model's price is kept in dollars per million input and output tokens (per hour of audio for a
  speech model), as published. The naira price is the dollar price times that day's rate.
- Each ledger step stores the naira prices it was charged at; the month's spend sums the steps.

## 7 · Events, jobs and notifications

Planned for PR2: a chain changed, a price accepted and a cap changed are audited events. **None
notifies anyone** (decision 21).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Implementation Team, System Administrator | All three tabs | Change chains, accept prices, set caps (edit) |
| Operations & People | All three tabs | Nothing: view only, to know when to recharge |
| Everyone else | Nothing: the module is not in their sidebar | |
| CEO | Everything, by the standing rule | The same as IT |

## 9 · AI and search

- **AI reads**: none (`// ai:none`): it is configuration, and the spend is read on its own tab.
- **AI routes**: none.
- **Search**: the three tabs are found by their words (AI control, models, AI spend, fallback,
  Gemini, Groq, Anthropic, OpenAI, DeepSeek, prices).

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`. Planned for PR2;
the rows below are the starting point.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| AI Control · Actions (`actions`) | AI Control as the title; each job with its actions; each chain as First, Fallback 1 to 3 with each model's provider and state pill; Make First; Edit Chain | Help terms on each job's name (what it is for, from §6.2) | How the chain is walked and when a provider is skipped: §6.1 |
| AI Control · Models (`models`) | Each model: name, provider, what it does, Available or Not on This Key, price in dollars and naira; Find Prices; each proposed price with its page, Accept and Edit | Help term on the naira price (the day's rate it used) | How Find Prices searches and why IT confirms: §1.1 decision 20 |
| AI Control · Spend (`spend`) | This month per provider against its cap, the overall cap, spend by action and by day; Set Cap | Help term on Monthly Cap (skipped for the rest of the month once reached) | How spend is summed: §6.3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| AI Control · Actions (`actions`) | Each job as a card with its first choice and its state | The action rows, one tap away | Make First in the chain's sheet | More, then AI Control; tabs scroll sideways |
| AI Control · Models (`models`) | Each model as a card: name, provider, Available, price | The chains it is in | Find Prices, full width at the foot | As above |
| AI Control · Spend (`spend`) | Each provider's spend against its cap as a card | Spend by day | Set Cap in the provider's sheet | As above |

## 11 · Edge cases

- **Every model in a chain skipped**: the call fails with a clear message (AI_UNAVAILABLE); for
  Transcription the browser's captions are shown as a draft.
- **A model renamed or withdrawn by its provider**: the next model list read marks it Not on This
  Key and the chain walks past it; Actions shows it failing.
- **The embedding model changed after indexing**: refused; a support step rebuilds the index first.
- **No rate for the day**: the last rate is used and the Spend tab says which day it is from.

## 12 · Donor code

The governance donors are named in MILESTONES §15 (spend caps, model configuration, per-module AI
access) and `REUSE_MAP.md`; what is taken from them is decided when PR2 starts.

## 13 · Open questions

1. **Operations' view**: Operations & People see all three tabs read only; TB to say if Actions and
   Models should be hidden from them.
2. **The daily limit warning**: decision 21 says AI Control notifies nobody; Settings · Integrations
   still sends Daily Limit Near at 80% of a daily limit (`integrations.md` decision 10). TB to say if
   that stops for AI providers too.
3. **How often Find Prices runs**: on request only, or also once a month.

## 14 · Change log

- 20/10/2026 · TB · Written from TB's answers of 20/10/2026 (§1.1): AI Control under System with
  Actions, Models and Spend; jobs, actions and chains of up to three fallbacks; per-provider caps
  with no notifications; Find Prices confirmed by IT; Data Answers through reads; DeepSeek without
  personal data; the job conventions and their check. To be built in PR2.
