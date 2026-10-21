# AI Control · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M10 (brought forward by TB, 20/10/2026) |
| Backend modules | `ai_governance` (shown as AI Control) |
| Frontend paths | `app/src/features/ai-control/` |
| Permission key(s) | `ai_control` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | AI Control · Actions, Models and Spend (#98 to #100) |
| Status | Built |
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

Asked when PR2 started (TB, 20/10/2026):

25. **The home is the `ai_governance` module** that MILESTONES §15 and the README already hold for
    M10's spend cap and model configuration, shown everywhere as **AI Control**, with its own
    permission key `ai_control` (decision 12). The README's `praxis_ai` row keeps `assistant` only.
26. **No Daily Limit Near for the AI providers.** Gemini, Groq, OpenAI, Anthropic and DeepSeek send
    no 80% alert (`integrations.md` decision 10 changes); Spend and Settings · Integrations show
    where each stands. Geoapify, the mail servers and Exchange Rates keep theirs.
27. **Data Answers is registered, not built.** PR2 registers it on Default with its own chain,
    Gemini's Flash model then its Pro model (decision 22), so its chain shows and can be changed.
    The assistant that chooses the reads is built with M10's Assistant and Knowledge Hub.
28. **Find Prices runs on request only**, when IT presses it on AI Control · Models. Nothing is
    spent unless someone asks.

After the first Find Prices on staging returned nothing for a list of 129 models (TB, 20/10/2026):

29. **Fewer models.** A provider's list leaves off its `-latest` aliases, Gemma's open models, and a
    dated or numbered snapshot whose base model is on the same list (`gemini-2.0-flash-001` when
    `gemini-2.0-flash` is there). A model in a chain is never dropped. The rows already stored are
    cleared by migration 10210 (`integrations.md` §6.11).
30. **Find Prices prices every model, 20 at a time.** One press asks about every model on a set-up
    provider's key that has no price, no proposal waiting and was not found on the page in the
    last 7 days, in requests of 20, each a billed search. Each request's proposals appear as it
    returns; a model the page does not price is marked **Not Listed**.
31. **New Prices, and Accept All.** Find Prices opens a sheet that shows the run's progress and the
    prices as they arrive. **Accept All** saves every waiting price in one press. **Find More**
    starts the next run for the models still to price, until none is left. A run that fails says
    why, in a few words.
32. **The Models tab opens on what matters**: the models in a chain first, then the rest the key
    can use. The Not on Key models (Gemini 2.5, retired 16/10/2026) are behind the Show filter.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| AI Control · Actions (`actions`) | Staff app, System group, after Praxis AI | `ai_control` view | The seven jobs, each with its chain (first choice and up to three fallbacks) and the state of each model in it; the actions, 25 a page, each with its job, whether it carries personal data, its chain and today's calls | Edit Chain, Make First, give an action its own chain, Use Job Chain to put it back (edit) |
| AI Control · Models (`models`) | Staff app | `ai_control` view | The models in a chain first, then the rest the key can use, 25 a page (Not on Key and Any behind the filter): what each does, its price in dollars and naira, the chains it is in; the New Prices sheet: Find Prices' progress, the prices it proposed with their pages, how many models are still to price or not listed | Find Prices, Accept All, Accept, Edit Price, Dismiss, Find More (edit); open the provider's connection |
| AI Control · Spend (`spend`) | Staff app | `ai_control` view | This Lagos month: each provider's spend against its cap, all AI against the overall cap, the day's rate, spend by day and, 25 a page, spend by action | Set Cap on a paid provider, Set Cap on all AI (edit) |
| Settings · Integrations (`integrations`) | Staff app | `integrations` view | Each AI connection's In Use reads AI Control's chains, and links to AI Control · Actions | As built (`integrations.md`) |
| Praxis AI · Ask | Staff app | Everyone with Praxis AI | Data Answers is registered on Default (decision 27) | Built in M10 |

## 3 · How the screens relate

1. Settings · Integrations saves a provider's key and reads its model list (`integrations.md` §3).
   AI Control · Models lists those models with their prices.
2. **Find Prices** emits `ai_control.prices_requested`; its outbox handler asks the Find Prices
   action's chain (Deep Reasoning) once per AI provider, with Google Search on, for that provider's
   prices, and keeps each answer as a proposal with the page it came from. The Models tab shows
   Finding Prices until the run ends. Nothing is saved to a model until IT presses **Accept** (or
   Edit Price, then Save); Dismiss drops a proposal.
3. **Accept** writes the dollar prices to the model through `integrations.service.setPrices` in
   AI Control's transaction and emits `ai_control.price_set`. **Edit Price** on a model sets them by
   hand, the same way.
4. AI Control · Actions builds each job's chain from the models. **Edit Chain** saves a whole
   chain (first choice and up to three fallbacks) and emits `ai_control.chain_changed`;
   **Make First** moves one model to the front in one press. An action given its own chain keeps
   it until **Use Job Chain** removes it (`ai_control.chain_reset`).
5. A feature's call names its action (`ai.complete({ purpose })`, `transcription.transcribe()`).
   The resolver (`services/ai/jobs.js`) walks the action's chain (§6.1); the first model left
   answers; the ledger records the action, the model and the naira prices of that step.
6. AI Control · Spend sums the ledger per provider for the Lagos month against each provider's cap
   and the overall cap. **Set Cap** emits `ai_control.cap_changed`. A provider at its cap is skipped
   by every chain until the month ends; nobody is told (decision 21).

## 4 · Data

Migration `10200_ai_control.sql` (M10's block; M10 brought forward). `ai_model` and
`exchange_rate` are PR1's (`integrations.md` §4); `ai_setting`, `ai_run` and `ai_run_step` are M0's.

| Table | Key columns | Notes |
|---|---|---|
| `ai_chain` | `scope` (`job`, `action`), `key`, `position` (1 to 4), `provider`, `model`, `updated_by` | One row per link. A job or action with no rows uses the chain in code (§6.1). UNIQUE (`scope`, `key`, `position`) |
| `ai_provider_cap` | `provider` (primary key), `monthly_cap_ngn` `numeric(18,2)` or null, `updated_by` | A paid provider's monthly cap in naira; null or no row is no cap |
| `ai_price_proposal` | `ai_model_id`, the four dollar prices and `usd_per_thousand_searches`, `source_url`, `status` (`proposed`, `accepted`, `dismissed`), `run_id`, `decided_by`, `decided_at` | One open proposal per model: a newer one replaces it |
| `ai_price_run` (10210) | `status` (`running`, `done`, `failed`), `batches_total`, `batches_done`, `proposals`, `not_listed`, `error_code`, `requested_by`, `started_at`, `finished_at` | One per Find Prices press: the New Prices sheet's progress and outcome. A run still `running` after 15 minutes is taken as lost |
| `ai_model` (PR1) | adds `usd_per_thousand_searches` `numeric(12,4)`; `price_not_listed_at` (10210) | Google Search's price, for Find Prices; when the provider's page last did not price the model |
| `ai_run_step` (M0) | adds `audio_seconds`, `ngn_per_audio_hour`, `searches`, `ngn_per_search`, `usd_ngn_rate`, `rate_day`; kind adds `search` | What the step was charged at, so a new price or rate never rewrites past spend |
| `ai_setting` (M0) | `monthly_cap_ngn` is the overall cap, set on Spend | `vendor` and `model` are no longer read: the chains decide (§6.1) |

The registry of actions is code, `src/services/ai/actions.js` (§6.5). Grants are reference data:
`seeds/reference/10290_seed_ai_control.sql` (§8). No chain, cap or price is seeded (A26).

## 5 · API

Under `/api/v1/ai-control`, schemas in `packages/contract/schemas/ai_control.js`.

| Method and path | Body → response | Permission |
|---|---|---|
| `GET /jobs` | → `AiJobPage`: the seven jobs (one page), each with its chain and each link's state | `ai_control` view |
| `GET /actions` (`job`, `q`, `page`) | → `AiActionPage`, 25 a page | view |
| `PUT /chains/:scope/:key` | `AiChainSave` (`links`: 1 to 4 `{provider, model}`) → `AiChain` | edit |
| `POST /chains/:scope/:key/first` | `AiMakeFirst` (`position`) → `AiChain` | edit |
| `DELETE /chains/action/:key` | → `no_content`: the action is back on its job's chain | edit |
| `GET /models` (`provider`, `capability`, `show`, `q`, `page`) | → `AiControlModelPage`, 25 a page, models in a chain first; `show` is `usable` (the default: on the key, or not checked), `not_on_key` or `all`; Edit Chain's pickers ask for their job's `capability` | view |
| `GET /models/summary` | → `AiModelsSummary`: the newest run (status, batches, proposals, not listed, error), the open proposals, the models still to price and not listed, the day's rate | view |
| `PUT /models/:id/prices` | `AiPricesSave` → `AiControlModel` | edit |
| `POST /prices/find` | → 202 `AiFindPrices` (`requested_at`) | edit |
| `GET /prices` (`page`) | → `AiPriceProposalPage`, the open proposals, 25 a page | view |
| `POST /prices/:id/accept` | `AiPricesSave` (the proposal's prices, edited or not) → `AiControlModel` | edit |
| `POST /prices/accept-all` | → `AiAcceptAll` (`accepted`): every open proposal, as proposed | edit |
| `POST /prices/:id/dismiss` | → `no_content` | edit |
| `GET /spend` | → `AiSpend`: the month, the rate, all AI and each provider against their caps, spend by day | view |
| `GET /spend/actions` (`page`) | → `AiSpendActionPage`, this month by action, 25 a page | view |
| `PUT /caps/:provider` | `AiCapSave` (`monthly_cap_ngn` or null) → `AiSpend` | edit |
| `PUT /cap` | `AiCapSave` → `AiSpend`: the overall cap | edit |

Errors: 422 `NOT_AN_AI_PROVIDER`, `MODEL_NOT_LISTED`, `MODEL_CANNOT_DO_JOB`, `DEEPSEEK_PERSONAL_DATA`,
`ANTHROPIC_SONNET_HAIKU`, `ONE_EMBEDDING_MODEL`, `NOT_PAID`; 404 `NO_SUCH_JOB`, `NO_SUCH_ACTION`;
409 `EMBEDDINGS_LOCKED`, `ALREADY_FINDING`; 503 `NO_SEARCH_MODEL` when no model in Find Prices'
chain can search.

## 6 · Rules and calculations

### 6.1 Choosing the model for a call

1. The chain, in this order: the action's stored chain; else the chain the registry gives the
   action (Data Answers: Flash, then Pro); else its job's stored chain; else its job's chain in
   code, which takes the best model of a family the key can use (`services/ai/jobs.js`, PR1).
2. Walk it in order and pass a model by when it is (its state on Actions):
   - **Not Set Up**: its provider has no key;
   - **Not on Key**: the key's list no longer names it;
   - **Daily Limit**: its provider is on the Free plan and today's limit is used;
   - **Skipped**: its provider said its quota is used up and the reset time it gave has not passed;
   - **At Cap**: its provider has reached its monthly cap;
   - **Personal Data**: it is DeepSeek and the action carries personal data;
   - **Cannot Search**: the action searches (Find Prices) and the model has no search.
   The rest are **Ready**.
3. Call the first Ready model. A refusal for quota or rate limit, a failure, or no answer within
   30 seconds moves to the next. A refusal that says when the provider will take requests again
   (Groq's and Gemini's retry-after, Anthropic's reset time), or a prepaid balance spent (402),
   also marks the provider Skipped until then; a rate limit with no time is a moment's crowding
   and marks nothing. A wrong key or model is reported and the next model is asked. A chain of
   one model retries once after a failure, as M0's did. The run records the model that answered.
4. The overall monthly cap and the per-module switch (`ai_setting`, M0) refuse the call before any
   of this, whatever the chain says. With no provider set up at all, the stub answers (CI, a laptop).
5. Transcription's chain always ends in the browser's captions (`integrations.md` §6.14).

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

A chain's models must do the job: text for Default, Fast, Deep Reasoning and Top Tier; images for
Image Reading; audio for Transcription; embeddings for Embeddings (`MODEL_CANNOT_DO_JOB`).
Anthropic's models are Sonnet or Haiku only (`integrations.md` §1.2 decision 3).

### 6.3 Prices and spend

- A model's price is kept in dollars as published: per million input and output tokens, per
  million audio tokens, per hour of audio for a speech model, per thousand searches.
- A step's naira prices are the dollar prices times the day's USD to NGN rate
  (`shared/money/fx.js`; the newest rate when today's has not come in, and Spend says which day).
  A provider on the **Free plan** is charged nothing: its tokens and audio seconds are still kept.
  A model with no price yet uses `ai_setting`'s naira prices per million tokens, as M0 did.
- A step's naira is `input tokens × input price / 1,000,000 + output tokens × output price /
  1,000,000 + audio seconds × hour price / 3,600 + searches × search price`. The prices it used
  are kept on the step; the month's spend sums the steps and rounds once, at the end (M0's rule).
- Groq bills at least 10 seconds a request; the step keeps the billed seconds.
- A Gemini transcription's input tokens are audio: they use the audio price when it is set.

### 6.4 Find Prices

- A press opens an `ai_price_run` and emits `ai_control.prices_requested`; the outbox handler does
  the rest in the worker. It asks about every model on a set-up provider's key (available, or not
  checked yet) with no price, no open proposal, and no Not Listed mark from the last 7 days.
- The models go 20 to a request, one provider per request, through the `find-prices` action (Deep
  Reasoning, no personal data). Only a model that can search is called: Gemini's, with Google
  Search on; any other in the chain is Cannot Search. The answer is JSON listing, for each model
  asked about, the dollar prices and the pricing page; thinking is kept low and the answer has
  room for 20 models.
- After each request its proposals are kept and the run's `batches_done` and counts move, so the
  New Prices sheet fills as the run goes. A model the answer does not price is marked Not Listed.
- A proposal names one of our models and an `https` page. A page off the provider's own site is
  replaced by the first page Google Search returned.
- The run ends `done` when any answer was read, `failed` when no request could be read or none
  could be made: no model that can search (`NO_SEARCH_MODEL`), AI switched off, the overall cap
  reached, or every answer unreadable (`ANSWER_UNREADABLE`). Either keeps the first error's code,
  so a run that read some batches and not others says so. Switched off, a cap or no model that can
  search stops the run at once; any other error passes to the next batch.
- At most one run at a time (`ALREADY_FINDING`). Each request is a billed search.
- **Accept All** saves every open proposal as proposed, each audited (`ai_control.price_set`).

### 6.5 The registry and its check

- `src/services/ai/actions.js` declares each action once: `key` (the prompt and the ledger's
  `purpose`), `label`, `module`, `job`, `personal_data`, `chosen_by` and `chosen_at`, and for Top
  Tier a `reason`; optionally its own chain in code (Data Answers).
- Registered in PR2: Voice Note Transcription (Transcription, personal data, TB), Tidy Policy
  (Default, personal data, TB, `policies.md` §9), Data Answers (Default, personal data, TB,
  decision 27), Find Prices (Deep Reasoning, none, TB). Settings · Integrations' connection test
  (`integration-test`) is registered as direct: it calls the model under test and has no chain.
- `scripts/check/ai-actions.js` fails a build when an AI call names an action that is not
  registered, names it with anything but a literal, or a registry entry lacks its job, its
  personal-data answer, who chose it and when, or (Top Tier) its reason.

### 6.6 Embeddings

Embeddings has one model and no fallback (`ONE_EMBEDDING_MODEL`): vectors from two models cannot
share an index. Once `knowledge_embedding` holds a row the chain is locked (`EMBEDDINGS_LOCKED`);
changing it is a support step that rebuilds the index first (`docs/runbooks/`).

## 7 · Events, jobs and notifications

| Event | When | Follow-on |
|---|---|---|
| `ai_control.chain_changed` | Edit Chain or Make First saved | Audit only |
| `ai_control.chain_reset` | Use Job Chain | Audit only |
| `ai_control.prices_requested` | Find Prices pressed | Outbox: the search of §6.4, proposals written |
| `ai_control.prices_proposed` | A Find Prices request proposed prices | Audit only |
| `ai_control.price_set` | Accept, or Edit Price saved | Audit only |
| `ai_control.cap_changed` | Set Cap, a provider's or all AI | Audit only |

**None notifies anyone** (decision 21). No scheduled job: Find Prices runs on request (decision 28).

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Implementation Team | All three tabs | Everything (`ai_control` all) |
| System Administrator | All three tabs | Change chains, find and accept prices, set caps (view, edit) |
| Operations & People | All three tabs | Nothing: view only, to know when to recharge (decision 12) |
| Everyone else | Nothing: AI Control is not in their sidebar or ⌘K | |
| CEO | Everything, by the standing rule | The same as the Implementation Team |

## 9 · AI and search

- **AI reads**: none (`// ai:none`): it is configuration, and the spend is read on its own tab.
- **AI routes**: none.
- **Search**: the three tabs are found by their words (AI control, models, AI spend, fallback,
  chain, Gemini, Groq, Anthropic, OpenAI, DeepSeek, prices, find prices, cap). Chains, proposals
  and caps are not records anyone looks up: `search:none`.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| AI Control · Actions (`actions`) | AI Control as the title; each job as a card (desktop) with its chain as First and Fallback 1 to 3, each model's name, provider and state pill (Ready, Not Set Up, Not on Key, Daily Limit, Skipped Until a time, At Cap, Personal Data, Cannot Search); Make First on each fallback; Edit Chain (First Choice, Fallback 1 to 3, each a model picker searching the models that can do the job; Embeddings First Choice only; Save Chain); Locked on Embeddings once indexed; the actions with job, first choice, Personal Data, Own Chain and Not Built Yet pills, Calls Today; an action's sheet with Make First, Edit Chain and Use Job Chain; toasts "Moved to first", "Chain saved", "Back on its job's chain" | Help terms on each job's name (what it is for, from §6.2), on Personal Data (DeepSeek is passed by) and on Own Chain | How the chain is walked and when a provider is skipped: §6.1 |
| AI Control · Models (`models`) | Models as the title; Find Prices; the New Prices sheet, opened by Find Prices and by Review Prices while proposals wait: the run's progress ("Batch 2 of 4"), each proposed price (model, provider, price, page) with Dismiss, Accept All, and Find More once the run ends with models still to price; Still to Price and Not Listed counts; a failed run's reason in a few words ("No search model ready"); the models: name, provider and what it does, On Key (Available, Not on Key, Not Checked), Price ("$0.30 / $2.50 per M", "$0.111 an hour"), In Naira, In Chains; Provider and Show (On Key, Not on Key, Any) filters; a model's sheet with its prices, Per 1,000 Searches, In Chains, Edit Price (Input per Million, Output per Million, Audio per Million, Per Audio Hour, Per 1,000 Searches, each Optional) and Open Connection; toasts "Finding prices", "12 prices saved", "Prices saved", "Proposal dismissed" | Help terms on In Naira (the day's rate it used) and Not Listed (models the provider's page does not price; asked again after 7 days) | How Find Prices searches and why IT confirms: §1.1 decision 20, §6.4 |
| AI Control · Spend (`spend`) | Spend as the title; All AI: spent, against its cap (a meter, the percent and "₦19K of ₦100K cap"), Month Of, One Dollar, Rates Of; each provider: Free or Paid, Not Set Up, At Cap, spent, against its cap or "no cap", calls this month; Set Cap on All AI and each paid provider (Monthly Cap, Optional; blank removes it); Spend by Day (desktop); By Action: action, job, calls, spent; toasts "Cap set", "Cap removed" | Help terms on All AI and on Monthly Cap (what happens once reached) | How spend is summed: §6.3 |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| AI Control · Actions (`actions`) | Each job as a row with its first choice and its state, which opens the job's sheet | The fallbacks, in the job's sheet; the action rows below, each opening its own sheet | Make First and Edit Chain in the chain's sheet | More, then AI Control; tabs scroll sideways |
| AI Control · Models (`models`) | Each model as a card: name, provider, Available, price | The chains it is in, the naira price | Find Prices, full width at the foot; New Prices as a sheet with Accept All at its foot | As above |
| AI Control · Spend (`spend`) | All AI, then each provider's spend against its cap, as cards | Spend by day | Set Cap on a paid provider's card, opening a sheet | As above |

## 11 · Edge cases

- **Every model in a chain passed by**: the call fails with `AI_UNAVAILABLE`; for Transcription the
  browser's captions are shown as a draft (`integrations.md` §6.14).
- **A model renamed or withdrawn by its provider**: the next model list read marks it Not on Key
  and the chain walks past it; Actions shows it.
- **A provider's key removed**: its models show Not Set Up and every chain walks past them; the
  stored chains keep them for when the key returns.
- **The embedding model changed after indexing**: refused (`EMBEDDINGS_LOCKED`).
- **No rate for the day**: the newest rate is used and Spend says which day it is from; with no
  rate at all, paid models are charged at `ai_setting`'s naira prices.
- **A provider moved from Paid to Free**: its spend this month stays as charged; its cap stays
  stored and Spend shows it as Free.
- **Find Prices pressed twice**: the second press is refused while the first runs.
- **A run lost** (the worker restarted mid-run): after 15 minutes it is taken as ended, and Find
  Prices can be pressed again; the proposals it kept stay.
- **A model the page never prices** (an old or regional model): Not Listed, asked again after 7
  days; Edit Price sets it by hand.
- **A proposal for a model removed from the list**: it is dismissed with the model.

## 12 · Donor code

The M0 pipeline already carries what MILESTONES §15 names from the governance donors
(`REUSE_MAP.md` row for `modules/ai/governance/`): the gate every AI entry point calls, the hard
cap, cost from tokens and a price, rounding once. The chains, caps and Find Prices are new, and the
three tabs are built on `@mycity/ui`; nothing else is ported.

## 13 · Open questions

1. **The per-module switch** (`ai_setting.disabled_modules`, M0) has no screen yet; M10 decides
   whether it goes on AI Control.
2. **Actions registered later**: dictation, review cleanup, JD draft, CV screening, proposal
   draft, MOU draft and image reading are registered by the build that makes each one, asking the
   person which job (CLAUDE.md, §6.5).

## 14 · Change log

- 20/10/2026 · TB · Decisions 29 to 32 after the first Find Prices on staging returned nothing for 129 models (the answer was capped at 60 and cut short): fewer models kept, Find Prices in requests of 20 over every unpriced model with Not Listed marks, the New Prices sheet with Accept All and Find More, the Models tab opening on the models in a chain and on the key.

- 20/10/2026 · TB · PR2 built (API, UI, mobile): §2 to §11 as built; §6.1 step 3 says which refusals mark a provider Skipped (a reset time given, or a spent balance); `GET /models` filters by capability for Edit Chain's pickers; §10 lists every label, field and toast.

- 20/10/2026 · TB · PR2 started: decisions 25 to 28 (the `ai_governance` module shown as AI Control with its own `ai_control` key, no 80% alert for AI providers, Data Answers registered only, Find Prices on request) and §2 to §13 written as the build: chains, Make First, prices in naira from the day's rate, per-provider caps, Find Prices, the registry and its check.
- 20/10/2026 · TB · §13 lists the actions chosen before the registry exists: Tidy With AI (`policy-tidy`) on Default, personal data, from `docs/guides/policies.md` §9.
- 20/10/2026 · TB · Written from TB's answers of 20/10/2026 (§1.1): AI Control under System with
  Actions, Models and Spend; jobs, actions and chains of up to three fallbacks; per-provider caps
  with no notifications; Find Prices confirmed by IT; Data Answers through reads; DeepSeek without
  personal data; the job conventions and their check. To be built in PR2.
