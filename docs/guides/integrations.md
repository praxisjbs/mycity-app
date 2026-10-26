# Integrations · Engineering Guide

| | |
|---|---|
| Owner | TB |
| Milestone | M9 (brought forward by TB, 20/10/2026) |
| Backend modules | `integrations` |
| Frontend paths | `app/src/features/settings/integrations/` |
| Permission key(s) | `integrations` |
| Capabilities | none |
| Screens (PROGRESS.md rows) | #77 |
| Status | Built |
| Last changed | 21/10/2026 |

Sources: TB's twelve answers of 20/10/2026 (§1.1), TB's answers on AI providers, transcription and
exchange rates of the same day (§1.2, with `ai-control.md`), MILESTONES §14 (M9) and A4, the Mailbox guide
(`mailbox.md`), the maps work of 19/10/2026 (`foundation.md` §6.13), the web push keys
(`notifications.md` §6) and `docs/runbooks/dns-and-mail.md` §4.

---

## 1 · What it is for

Settings · Integrations is where the IT team connects the ERP to the outside services it runs on and
keeps their keys: mail out (the system sender), the staff mail server (mail in and out for each
person's mailbox), address search and maps (Geoapify), AI (Gemini) and web push. Values that change
from time to time live here, encrypted, instead of in the server's `.env` file, so nobody has to
sign in to the server to change a password or a key. Each connection is tested before it is saved,
can be tested at any time, and is watched between tests.

It is for the Implementation Team and the System Administrator. Operations & People, Management and
the CEO's office have no reason to see a key, so the tab is not in their Settings.

### 1.1 Decisions (TB, 20/10/2026, binding)

1. **Everything mail moves.** The system sender (server, port, security, login, password, From,
   Reply-To, hourly limit) and the staff mail server (IMAP in, SMTP out, ports, each person's
   hourly limit, the sync interval, live connections). Changes apply without a restart.
2. **A registry, so each key is an addition.** Gemini's key and the web push keys join in this
   build with mail and Geoapify; the next provider is a definition, a contract schema and a form.
3. **The page wins, the file is the fallback.** A connection saved here is used; until then the
   server file's values keep working and the page says where the values come from.
4. **A server with no mail settings starts, and holds mail.** System mail waits in its queue until
   mail is set up; nothing is lost and nothing is faked (A4).
5. **IT only, its own key.** A new `integrations` permission, granted to the Implementation Team and
   the System Administrator only; the CEO passes as everywhere.
6. **A saved key or password is never shown again.** The page shows the last four characters of a
   key, who set it and when; saving or replacing one needs a fresh sign-in.
7. **Test before every save.** Save tests what was typed and saves only if the test passes; the
   reason shows on the field. Test re-checks the settings in use at any time.
8. **Mail tests.** Test signs in to the SMTP server without sending; Send Test Email delivers a real
   message to the tester's own address, counted against the hourly limit. The staff mail server is
   checked for TLS and its certificate only (it uses nobody's password).
9. **Geoapify test.** One address search (an address the tester can edit, prefilled with a Lagos
   one, showing the suggestions), one reverse lookup and one map tile, each with pass or fail and
   its time.
10. **Watching.** Every real call is counted per day (30 days kept, 7 shown); a daily limit per plan
    is entered here and IT is warned at 80%, except for the AI providers (`ai-control.md` decision
    26); the worker checks mail every 15 minutes, which costs nothing; paid services are never
    probed; a failing connection shows on Settings · Status and IT is told.
11. **A staff mail server change moves every mailbox.** The new hosts apply to every connected
    mailbox at once, each is synced again with its saved password, and anyone refused gets the
    Reconnect banner.
12. **Mailbox connections stay in Mailbox.** Integrations holds company settings only. This replaces
    the Mailbox guide's "connection under Settings · Integrations".

Refinements made while writing this guide, within those decisions (TB to overrule):

- A password shows no characters at all, only Saved and who set it when; an API key shows its last
  four (decision 6). Four characters of a 12 character password is a third of it.
- A saved password is never sent to a new place: changing the host, the port or the username of a
  connection whose password is saved needs the password typed again (decision 7). Otherwise anyone
  with edit could point the connection at their own server and press Save to collect it.
- Alerts go through System Health (decision 10): each connection's state is a readiness check, so
  Settings · Status shows it and System Health's own notices (`system_health.check_down`,
  `check_recovered`) tell IT. There is no second alert path to keep in step with the first.
- TLS cannot be switched off on the page. `MAILBOX_TLS=false` stays a server-file switch for a
  local test server only, so a password never crosses the network in clear.

### 1.2 AI providers, transcription and exchange rates (TB, 20/10/2026, binding)

The first build sent Gemini out like Geoapify: a key and nothing else. These answers replace that.
They are built in two pull requests: **PR1** (this guide) puts every connection on this page and
makes voice notes transcribe; **PR2** builds AI Control, the module that decides which model each
AI feature uses (`ai-control.md`, decisions 12 to 24 there).

1. **Six more connections.** Gemini, **Groq**, **OpenAI**, **Anthropic** and **DeepSeek** in the
   AI group, and **Exchange Rates** (exchangerate-api.com) in a new Finance group. Each has its
   key, its test before save, its daily limit and its use counted, like Geoapify. Groq is the
   speech service (groq.com), not xAI's Grok.
2. **Each AI connection has a model list.** A reference seed holds today's models and what each
   does (text, audio, image, embeddings) with its list price. Saving or testing the key reads the
   provider's own model list, which costs nothing: it marks which models this key can use and adds
   the ones the seed does not know. **Add Model** takes a model id, what it does and an optional
   endpoint URL (the provider's own when blank). Model names change often (Google limited the 2.5
   models to existing projects in September 2026), so the live list decides what can be picked.
3. **Anthropic is for top-tier work, Sonnet and Haiku only.** Its list filters out Opus and Fable;
   nothing uses Anthropic until a feature needs long, careful drafting (proposals, MOUs).
4. **Free or Paid, set on the page.** Every connection with a daily limit has a Plan, shown as a
   pill on the list. It starts as Exchange Rates, Groq and Geoapify **Free**; Gemini, OpenAI,
   Anthropic and DeepSeek **Paid**, and IT changes it when a plan is upgraded. On Free the daily
   limit is a hard stop: the call is not made and transcription moves to the next provider. On
   Paid the limit counts and warns as it does now (decision 10), and spend is shown in naira.
5. **Staging and production share the keys and split the limits.** The same Groq and Gemini keys
   on both, each environment's daily limit set to its share of the plan, as the mail limits are
   split (§6.10). Groq counts its free allowance per organisation, so a second key in the same
   organisation would not add any.
6. **Transcription runs Groq, then Gemini, then the browser.** Groq's Whisper is first; Gemini
   takes over when Groq cannot answer; the browser's own captions are the last resort.
7. **Skip until reset.** A provider is passed over when it refuses (quota or rate limit), fails, or
   takes more than 30 seconds. Once it says its quota is used up, every request goes straight to
   the next provider until the reset time it gave, then back to it on its own. Reaching the daily
   limit set on this page counts as used up, which keeps staging inside its share.
8. **The browser captions while the sender records.** Chrome, Edge and Safari write captions
   alongside the recording; they are kept with the voice note as a draft and used only when Groq
   and Gemini both fail. Firefox, and devices that allow only one use of the microphone, record
   without captions.
9. **Transcribed on request, as now.** Transcribe under a voice note asks the server; the
   transcript is stored once and everyone after gets it at once.
10. **Exchange rates daily at midnight, with Sync beside the rate.** One request at 00:00 Lagos
    brings every currency against the dollar (about 31 of the free plan's 1,500 requests a month);
    each day's table is kept, so a later module (billing) switches currency with the same call.
    **Sync Rates** beside the rate fetches it now. A failed fetch keeps the last rate and tries
    again within the hour.
11. **Status shows every connection.** Each connection on this page is a readiness check on
    Settings · Status, so one screen says whether everything is healthy.

Refinements made while recording these, within those decisions (TB to overrule):

- The seed holds model ids, capabilities and list prices only, never a key or an endpoint URL
  (A26, `MIGRATIONS.md` §9): like Nigeria's public holidays, a model list is set by an outside
  party, not a business choice MyCity makes. A custom endpoint is typed on the page by IT.
- Until AI Control is built (PR2), each job uses the best model the key can use, in the order the
  code prefers (the newest stable Flash for Default, `services/ai/jobs.js`; §6.11), so a new key works
  without anyone picking a model first.
- The five providers that joined here and Exchange Rates have no server-file fallback: their keys are
  set on this page only (decision 3 keeps the fallback for the connections that had one).
- Groq's model for voice notes is `whisper-large-v3`, the more accurate of its two Whisper
  models; turbo is cheaper and a little less accurate.
- A browser caption is never stored as the transcript: it is shown, marked as a draft, and the next
  Transcribe tries Groq and Gemini again.

### 1.3 Pausing system mail, and refused addresses (TB, 21/10/2026, binding)

On the Namecheap plan's 50 recipients an hour, system mail ran out of its hour each morning and the
rest went out in bursts an hour apart, so the Milestone 1 handover could not count on an invitation
arriving. Until the plan moves to 10,000 an hour, IT can pause system mail.

1. **Pause Mail on the System Sender.** Beside Test on its panel, for `integrations` edit (the IT
   team; the CEO passes). Each environment pauses on its own page. The System Sender's row shows
   Paused, and Settings · Status reads Mail as Paused.
2. **What still goes while paused**: an invitation, a password reset and Send Test Email, and the
   server's own health alarm (which mails when the database may be down and so cannot read the
   pause). The Mailbox is each person's own mail, not system mail, and is never paused.
3. **Notices reach people by push instead.** A notice due by email is pushed to the person's
   devices even where their push switch for its category is off, and the bell has it as always.
4. **On Resume**: a notice's email and a daily digest from the pause are dropped (push and the bell
   carried them); any other system mail waited in its queue and goes out at once, paced.
5. **An invitation or a reset whose link stopped working while it waited is dropped**, not sent:
   a newer link replaced it, or it expired.
6. **A refused address is not tried again.** The mail server's 550 for a mailbox that does not
   exist or a domain that takes no mail is recorded as a warning (Faults, never pushed) and listed
   on the System Sender as Refused Addresses, with whoever holds the address, so IT corrects the
   email in People or creates the mailbox in cPanel.
7. **The daily digest goes only to people who have signed in** at least once (`notifications.md`).
8. **After the upgrade** the Hourly Limit is raised here and mail resumed. Nothing in code changes.

## 2 · Screens affected

| Screen / tab (slug) | Where | Who sees it | What it shows | What a person can do there |
|---|---|---|---|---|
| Settings · Integrations (`integrations`) | Staff app | `integrations` view: Implementation Team, System Administrator, the CEO | Every connection, filtered by group (Mail, Maps, AI, Finance, Notifications): its state, where its settings come from, its plan (Free or Paid), its last check, today's use against its daily limit | Open a connection; Test (edit) |
| A connection (side panel on desktop, a full-screen page on a phone) | Staff app, over Integrations | The same | Its settings in use (secrets as Saved, the plan, the jobs an AI connection's models do), the model list of an AI connection (25 a page), the exchange rate of Exchange Rates, the last test's steps, its checks (25 a page), 7 days of use | Edit Settings, Test, Add Model and Remove (an AI connection), Sync Rates (Exchange Rates), Send Test Email (System Sender), Remove Saved Settings, Replace Keys (Web Push) |
| Edit Settings (form; a two-step wizard for the two mail connections) | Staff app, in the panel or a full-screen sheet | `integrations` edit | The connection's fields, secrets as Saved, the plan | Save Settings (tests first) |
| Add Model (form) | Staff app, a modal (a sheet on a phone) over the connection | `integrations` edit | Model ID, Name, what it does, Endpoint | Add Model |
| Settings · Status (`status`) | Staff app | `system_health` view | A check for every connection: Maps and Staff Mail Server, and from PR1 Groq, OpenAI, Anthropic, DeepSeek, Exchange Rates and Web Push; Mail and AI read the settings in use, and AI is degraded while Gemini's connection fails | Read what is wrong and where to look (`system-health.md`) |
| Staff Community · Channels and Direct Messages | Staff app | Each member | A voice note's Transcribe, now through Groq, then Gemini, then the browser's captions, marked Draft (`community.md`) | Transcribe, Hide Transcript |
| Settings · Roles & Permissions (`roles-and-permissions`) | Staff app | `settings` view | `integrations` as a module a role can be granted | Grant or remove Integrations on a role |
| Settings · Notifications (`notifications`) | Staff app | `settings` view | The new notices Integration Changed and Daily Limit Near | Turn a notice off, change its channels |
| Mailbox (every tab) | Staff app | Each mailbox's owner | Unchanged; after a staff mail server change, the Reconnect banner for a refused password | Reconnect (`mailbox.md`) |
| Every address field and map (`AddressField`, `MapView`) | Staff app | Everyone | Unchanged; the suggestions and tiles use the key saved here | As before (`foundation.md` §6.13) |
| The bell and the notification pane | Staff app, both shells | `integrations` view holders | A connection changed by someone else, a daily limit at 80%; System Health's check down and recovered; System mail paused and resumed | Open the notice, which lands on the connection |
| The System Sender (its row and its panel) | Staff app, over Integrations | `integrations` view; Pause Mail and Resume Mail with edit | While paused, Paused on its row and a banner on its panel naming who paused it and when; Refused Addresses, 25 a page | Pause Mail, Resume Mail (§6.15) |

## 3 · How the screens relate

1. **The registry** (`src/shared/integrations/providers.js`) defines each connection once: its code,
   name and group, its settings and which of them are secret, the server-file variables it falls
   back to, whether the worker may watch it (free tests only), and how its use is counted and what
   its daily limit counts (§6.3). How each is tested is the module's
   (`src/modules/integrations/integrations.testers.js`, one tester per code). The page lists
   whatever the registry holds; a connection gets its database row the first time it is saved,
   checked or used.
2. **One reader** (`src/shared/integrations/settings.js`): `settings.of(code)` answers the saved
   connection with its secrets decrypted, else the server file's values, else `null` (not set up).
   Every consumer reads through it: system mail and its pacing, route and deliverability checks,
   the mailbox, its sync and IDLE loop, Geoapify, the AI governance and vendor call, the web push
   keys. Each process caches the answer and compares a version number kept in Redis on each read,
   so a save reaches the API and the worker within a second; without Redis the cache lives 30
   seconds.
3. **Edit Settings** → `PUT /integrations/:code`. The service asks for a fresh sign-in when a secret
   is in the body, refuses a changed destination without its secret, runs the provider's test on
   the typed values (outside any transaction) and, only when every step passes, saves in one
   transaction: the configuration on `integration_connection`, each secret encrypted into
   `integration_secret`, the check, and `integration.saved` (audited with the fields that changed,
   never a secret's value). After the commit it bumps the version. The outbox tells the other IT
   holders.
4. **A failed test before save** answers 422 with the failing step on its field (Password refused,
   Server not found, Key refused) and saves nothing; the attempt is recorded as a check of kind
   `save`, so its steps are on the Checks list.
5. **Test** → `POST /integrations/:code/test` runs the test on the settings in use (saved or file)
   and records it. **Send Test Email** → `POST /integrations/mail_sender/test-email` sends the
   `integration-test` template to the tester's own work email through system mail, paced like any
   other message, and records it.
6. **Remove Saved Settings** → `DELETE /integrations/:code` (fresh sign-in) deletes the saved
   configuration and its secrets; the server file's values apply again, or the connection reads Not
   Set Up. `integration.removed` is audited and told.
7. **Replace Keys** (Web Push) → `POST /integrations/web_push/replace-keys` (fresh sign-in) stores a
   new VAPID pair. Its key id changes, so every phone and computer subscribes again the next time
   the app starts (`notifications.md` §3); a push to an old subscription is refused and the
   subscription dropped, as today.
8. **A staff mail server change** (`integration.saved` or `integration.removed` for
   `mailbox_server`): the Mailbox module's outbox handler re-points every connected `mail_account`
   at the new hosts (the same autodiscover as Connect) and queues a sync for each; a refused password
   marks the account `needs_reconnect`, which already notifies its owner and shows the Reconnect
   banner. The IDLE loop closes its connections and opens them on the new hosts; the sync interval
   and the live connections apply at the next tick.
9. **System sender saved**: mail held because nothing was set up goes out at once (the handler
   promotes the waiting `email-send` jobs); otherwise each held job retries within 15 minutes.
10. **Watching** (`integrations-watch`, every 15 minutes, worker): tests every connection whose test
    is free (the system sender signs in; the staff mail server's IMAP and SMTP hosts are checked for
    TLS and their certificate) and records it as kind `watch`. Geoapify and Gemini are never probed;
    their state comes from real use.
11. **Real use**: every call to a provider (an address search, a reverse lookup, a tile, an AI
    request, a system mail message, a mailbox sync or send, a push) is counted through
    `usage.record()`, in memory, and flushed every 15 seconds into `integration_usage`, one row per
    connection, day and kind. The connection's state follows the latest outcome, whether a check or
    a real call. Crossing 80% of the daily limit emits `integration.quota_warning`, once a day; an AI
    provider never does (`ai-control.md` decision 26).
12. **Settings · Status**: the readiness checks `mail` (a live sign-in, as before, now with the
    settings in use) and `ai`, and the new `maps` and `mail_server` (the stored state, no call out).
    System Health's snapshot every 5 minutes sees a check go down or come back and tells IT.
13. **Nightly** (`integrations-purge`): checks older than 90 days and use older than 30 days are
    deleted.
14. **An AI connection's model list** (§6.11): a save or a test reads the provider's own list with the
    key (step `key`, free), names the jobs its models can do (step `models`) and, except Groq, makes
    one tiny request (step `answer`, recorded in the AI ledger). When the steps pass the service keeps
    the list in the check's transaction: a model on it is available and seen now, a new one joins as
    `provider`, one it no longer names is not available. The version is bumped, so each job's model
    is worked out again in every process.
15. **Add Model** → `POST /integrations/:code/models` keeps a model by hand (`added`), with an endpoint
    of its own when given; `DELETE /integrations/:code/models/:id` takes one added by hand off. Both
    are audited (`integration.model_added`, `integration.model_removed`) and tell nobody.
16. **Exchange Rates** (§6.13): the `exchange-rates` job ticks at one minute past each hour and fetches
    today's table while it is missing; **Sync Rates** (`POST /integrations/exchange_rates/sync`) fetches
    it now. Either records a check of kind `sync` and keeps the table in `exchange_rate`, which
    `shared/money/fx.js` reads for any module.
17. **The Free plan's stop** (§6.12): `shared/integrations/quota.js` answers whether a Free connection
    has reached its daily limit; Geoapify's real calls, the transcription chain and the rate fetch ask
    it before calling out.
18. **A voice note's Transcribe** (§6.14): `services/ai/transcription.js` walks the Transcription job's
    chain, Groq then Gemini, skipping a provider until its quota resets, and falls back to the captions
    the sender's browser wrote, as a draft that is never stored.

19. **Pause Mail** → `POST /integrations/mail_sender/pause` sets `paused_at` and `paused_by` on the
    System Sender's row in one transaction with `integration.mail_paused`, and bumps the version, so
    every process reads it within a second (§6.15). Pressed again it changes nothing.
20. **Resume Mail** → `POST /integrations/mail_sender/resume` clears them with `integration.mail_resumed`;
    its outbox handler promotes the `email-send` jobs held for the pause.
21. **Refused Addresses** → `GET /integrations/mail_sender/refusals`: `mail_refusal`, written by system
    mail as it sends (`shared/integrations/refusals.js`, §6.16), newest refusal first, 25 a page.

## 4 · Data

| Table | Key columns | Notes |
|---|---|---|
| `integration_connection` (`9000`, extended by `9200`) | `integration_connection_id`, `code` (citext, unique: `mail_sender`, `mailbox_server`, `geoapify`, `gemini`, `web_push`), `provider` (the registry's kind), `display_name`, `configuration` (the saved settings that are not secret, checked by the provider's contract schema; `{}` when nothing is saved), `saved_at`, `saved_by`, `daily_limit`, `status` (`ok`, `failing`, `unchecked`), `state_at`, `last_checked_at`, `last_ok_at`, `last_error_code`, `last_error`, `quota_warned_on` | One row per connection, made the first time it is saved, checked or used. `saved_at` null means nothing is saved here and the server file applies. Configuration columns are written by the module's service; the state columns by `shared/integrations/state.js` (checks, real use) |
| `integration_secret` (`0090`, extended by `9200`) | `provider` (the connection's code), `key` (the field: `password`, `api_key`, `vapid`), `ciphertext`, `key_version`, `active`, `hint`, `set_by`, `rotated_at` | AES-256-GCM under `ENCRYPTION_KEY`, bound to `integration_secret:<provider>:<key>` (§6.4). `hint` is the last four characters of an API key, null for a password or a generated pair. The mailbox's own rows (`mailbox`, `mail_conn:<id>`) are unchanged |
| `integration_check` (`9200`, new) | `integration_check_id`, `integration_connection_id` (cascade), `kind` (`save`, `test`, `test_email`, `watch`), `ok`, `steps` (each step's key, result, time and code), `error_code`, `checked_by` (null for `watch`), `created_at` | Append-only; deleted after 90 days. `steps` is open-ended per provider, so it is `jsonb` |
| `integration_usage` (`9200`, new) | `integration_usage_id`, `integration_connection_id` (cascade), `day` (Lagos date), `kind` (`search`, `reverse`, `tile`, `call`, `transcribe`, `rates`, `send`, `sync`, `push`; `9210` adds `transcribe`, seconds of audio, and `rates`), `calls`, `failures`, `units` (`numeric(12,2)`); unique on connection, day and kind | Telemetry, like `request_stat`: no event, no audit row. Deleted after 30 days |
| `integration_connection.plan` (`9210`) | `free`, `paid`, or null | Null keeps the registry's starting plan (decision 4); a save sets it, a removal clears it |
| `ai_model` (`9210`, new) | `ai_model_id`, `provider` (`gemini`, `groq`, `openai`, `anthropic`, `deepseek`), `model` (citext, the id the API takes), `display_name`, `capabilities` (`text`, `image`, `audio`, `embeddings`), `available` (null until the key's list is read), `source` (`seed`, `provider`, `added`), `endpoint_url` (an added model's own, `https://` only), `input_usd_per_million`, `output_usd_per_million`, `audio_usd_per_million`, `usd_per_audio_hour` (`numeric(12,4)`, list prices in dollars), `seen_at`, `added_by`; unique on provider and model | Seeded by `9291` (ids, capabilities and the list prices known; never a key or a URL). Written by the integrations service only: a save or a test keeps the key's list; Add Model and Remove. Prices are confirmed by Find Prices in PR2 (`ai-control.md`) |
| `exchange_rate` (`9220`, new) | `exchange_rate_id`, `day` (the Lagos day it is used for), `base`, `currency` (ISO 4217), `rate` (`numeric(24,10)`, units of `currency` to one `base`), `provider_updated_at`; unique on day, base and currency | Every currency against the dollar, one table a day, kept; a second fetch the same day replaces it. Read through `shared/money/fx.js` only |

`9200` drops `integration_connection.integration_secret_id`: nothing ever wrote it, and a connection
can hold more than one secret, so secrets are found by provider and key instead. It adds the CHECK
on `status` and changes its default from `inactive` to `unchecked`; no row existed. `9210` widens the
CHECKs on `integration_check.kind` (adds `sync`) and `integration_usage.kind` (adds `transcribe` and
`rates`); its DOWN deletes rows of those kinds before narrowing them again.

| `integration_connection.paused_at`, `paused_by` (`9230`) | When system mail was paused and by whom | The System Sender's row only; null while it is not paused (§6.15) |
| `mail_refusal` (`9230`, new) | `mail_refusal_id`, `email` (citext, unique), `template`, `smtp_code`, `reply` (the server's words, 300 characters), `refusals`, `first_refused_at`, `last_refused_at` | One row per address the mail server refused for good (§6.16). Telemetry, like `integration_usage`: no event, no audit row. Deleted when mail to the address is accepted again, or after 30 days untouched |

Schema migration file(s): `migrations/9200_integrations.sql`, `migrations/9210_integrations_ai_models.sql`,
`migrations/9220_exchange_rates.sql`, `migrations/9230_integrations_mail_pause.sql`. Reference-data file(s): `seeds/reference/9290_seed_integrations.sql`
(the `integrations` grant for the Implementation Team and the System Administrator, the `9190`
pattern), `seeds/reference/9291_seed_ai_models.sql` (the starting model lists, §1.2). No connection,
key or URL is seeded (A26).

## 5 · API

All under `/api/v1/integrations`. Secrets never appear in a response.

| Method and path | Contract | Permission · scope | Paged | Notes |
|---|---|---|---|---|
| `GET /` | `IntegrationListQuery` → `IntegrationPage` | `integrations` view · all | yes, 25 | Every connection the registry holds, in its order. Filter: `group` |
| `GET /summary` | → `IntegrationSummary` | `integrations` view · all | | The cards above the list: every connection counted by state (`working`, `failing`, `unchecked`, `not_set`), whatever the list's filter |
| `GET /:code` | → `Integration` | `integrations` view | | Settings in use, secrets as `{ key, set, hint, set_by_name, set_at }`, source, state, the last check, 7 days of use |
| `GET /:code/checks` | `IntegrationCheckListQuery` → `IntegrationCheckPage` | `integrations` view | yes, 25 | Newest first. Filters: `kind`, `ok` |
| `PUT /:code` | `IntegrationSave` → `Integration` | `integrations` edit | | Tests first (§6.5). 403 `REAUTH_REQUIRED` when a secret is sent outside the fresh sign-in window; 422 `TEST_FAILED` with fields; 422 `SECRET_REQUIRED` for a changed destination; 409 `STALE` when someone saved since the form opened |
| `DELETE /:code` | → 204 | `integrations` delete | | Fresh sign-in. The server file applies again |
| `POST /:code/test` | `IntegrationTestBody` → `IntegrationCheck` | `integrations` edit | | The settings in use. `address` is Geoapify's search text |
| `POST /mail_sender/test-email` | `EmptyBody` → `IntegrationCheck` | `integrations` edit | | To the tester's own work email; 429 `MAIL_PACED` when the hour is full |
| `POST /mail_sender/pause` | `EmptyBody` → `Integration` | `integrations` edit | | Pause system mail (§6.15); already paused changes nothing |
| `POST /mail_sender/resume` | `EmptyBody` → `Integration` | `integrations` edit | | Resume it; held mail goes out at once |
| `GET /mail_sender/refusals` | `MailRefusalListQuery` → `MailRefusalPage` | `integrations` view | yes, 25 | The addresses the mail server refused, newest first, each with `person_name` (a login's, else an employee's); `q` searches the address |
| `POST /web_push/replace-keys` | `EmptyBody` → `Integration` | `integrations` edit | | Fresh sign-in |
| `POST /exchange_rates/sync` | `EmptyBody` → `IntegrationCheck` | `integrations` edit | | Fetches today's rates now; a check of kind `sync` |
| `GET /:code/models` | `AiModelListQuery` → `AiModelPage` | `integrations` view | yes, 25 | An AI connection's model list, usable first then by name, each with the jobs it does (`in_use`). Filters: `capability`, `available`; `q` searches the id and the name. 404 for a connection with no list |
| `POST /:code/models` | `AiModelCreate` → `AiModel` | `integrations` edit | | Add Model: 409 `ALREADY_LISTED` on `model`; Anthropic takes `claude-sonnet-*` and `claude-haiku-*` only (422 on `model`) |
| `DELETE /:code/models/:id` | → 204 | `integrations` delete | | A model added here only; a seeded or listed one is a 404 |

`:code` is one of the registry's codes (`IntegrationParams`), anything else a 422. A save of a key
connection (Geoapify, the AI providers, Exchange Rates) takes `plan`; left out, the plan in force
stays. The settings of an AI connection are `in_use` (each job its models do, first choice or
fallback), `models` and `available` (the list's size and how much of it the key can use); Exchange
Rates' are `usd_ngn`, `rate_day`, `fetched_at` and `currencies`. Test and Send
Test Email need edit because they act on the connection: a test email is a real message and a
Geoapify test spends about two credits.

## 6 · Rules and calculations

### 6.1 Where a connection's values come from

- **Whole, never mixed**: the saved connection, else the server file, else nothing. A field is never
  taken from one and its neighbour from the other.
- The page says which (`source`: `saved`, `file`, `none`).
- A saved connection whose secret cannot be decrypted (the `ENCRYPTION_KEY` changed) is `failing`
  with `SECRET_UNREADABLE`. The file's values are not used instead: a saved connection that quietly
  stopped being used would hide the problem. IT saves the secret again.
- The staff mail server and web push always have a value: the file's defaults (each address's own
  domain, ports 993 and 465) and a generated key pair respectively.

### 6.2 What stays in the server file

`APP_ENV`, `NODE_ENV`, ports and paths, the database and Redis, the sign-in secrets,
**`ENCRYPTION_KEY`** (it protects everything on this page, so it cannot live behind it), the origins,
the media tools, the rate limits, `ALERT_WEBHOOK_URL` and `ALERT_WHATSAPP_URLS` (an alert must reach
someone when the database is down), `METRICS_TOKEN`, the AI tuning (`GEMINI_MODEL`, the timeout,
the token ceiling and the prices, which Praxis AI's own settings override), `MAIL_RBL_HOSTS` (the
deliverability check's blocklists, not a connection) and `MAILBOX_TLS` (§1.1). The variables this
page replaces stay readable as the fallback, and `.env.example` says so on each.

### 6.3 The connections

| Code · name · group | Settings (secret in bold) | Server file fallback | Test steps | Watched | Use counted (units) · daily limit counts |
|---|---|---|---|---|---|
| `mail_sender` · System Sender · Mail | `host`, `port`, `security` (`tls` from the first byte, or `starttls` required), `username`, **`password`**, `from` (an address, or Name and address), `reply_to`, `per_hour` (1 to 100,000), `local_domains` (blank, or the domains whose mailboxes are on this server, comma separated: mail to them is delivered without the route check) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_SEND_PER_HOUR`, `SMTP_LOCAL_DOMAINS`; applies when `SMTP_HOST` is set | `connect`, `sign_in`; Send Test Email adds `send` | Yes | `send` (recipients) · none: the hourly limit is the pacing |
| `mailbox_server` · Staff Mail Server · Mail | `imap_host` (blank: each address's own domain), `imap_port`, `smtp_host` (blank likewise), `smtp_port`, `per_person_per_hour` (1 to 10,000), `sync_every_min` (1 to 60), `live_connections` (0 to 30) | `MAILBOX_IMAP_HOST`, `MAILBOX_IMAP_PORT`, `MAILBOX_SMTP_HOST`, `MAILBOX_SMTP_PORT`, `MAILBOX_SEND_PER_HOUR`, `MAILBOX_SYNC_EVERY_MIN`, `MAILBOX_IDLE_MAX`; always applies | `imap`, `smtp`: a TLS connection, the certificate checked against the host, the server's greeting. A blank host is checked at the system sender's From domain | Yes | `sync` (mailboxes synced), `send` (recipients) · none |
| `geoapify` · Geoapify · Maps | **`api_key`**; `daily_limit` | `GEOAPIFY_API_KEY` | `search` (the typed address; up to six suggestions shown), `reverse` (a point in Lagos), `tile` (zoom 15 over Lagos) | No | `search` (1 credit), `reverse` (1), `tile` (0.25: four tiles to a credit) · credits (the free plan's is 3,000) |
| `gemini` · Gemini · AI | **`api_key`**; `daily_limit`; `plan` (Paid); the jobs its models do are shown (§6.11) | `GEMINI_API_KEY` | `key` (Google's model list, free), `models` (the jobs it can do), `answer` (one tiny prompt to the Default model, a few tokens, recorded in the AI ledger as `integration-test`) | No | `call` (requests) · requests |
| `groq` · Groq · AI | **`api_key`**; `daily_limit`; `plan` (Free) | none | `key`, `models` (Whisper must be on the list); no `answer`, which would spend ten free seconds | No | `transcribe` (seconds of audio billed, at least ten a request), `call` (counts nothing toward the limit) · seconds of audio |
| `openai` · OpenAI · AI | **`api_key`**; `daily_limit`; `plan` (Paid) | none | `key`, `models`, `answer` (one embedding of "OK") | No | `call` · requests |
| `anthropic` · Anthropic · AI | **`api_key`**; `daily_limit`; `plan` (Paid) | none | `key` (Sonnet and Haiku only), `models`, `answer` (one tiny prompt to Haiku) | No | `call` · requests |
| `deepseek` · DeepSeek · AI | **`api_key`**; `daily_limit`; `plan` (Paid) | none | `key`, `models` (any model on the list: no job uses DeepSeek yet), `answer` | No | `call` · requests |
| `exchange_rates` · Exchange Rates · Finance | **`api_key`**; `daily_limit`; `plan` (Free) | none | `rates` (one fetch of today's table, kept when the test passes; the naira rate and the number of currencies in its findings) | No | `rates` (requests) · requests |
| `web_push` · Web Push · Notifications | `subject` (`mailto:` or `https:`); **the key pair**, made here, shown as its key id | `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `keys` (the pair signs a token), `push` (to the tester's own devices; skipped when they have none) | No | `push` (pushes delivered) · none |

A step's codes, and the field each lands on when Save is refused:

| Code | Field | Field error |
|---|---|---|
| `SERVER_NOT_FOUND` | the host | Server not found |
| `NO_ANSWER` | the port | No answer on port |
| `TLS_FAILED` | the host | Secure connection failed |
| `CERTIFICATE_MISMATCH` | the host | Certificate name differs |
| `AUTH_FAILED` | `password` | Password refused |
| `SENDER_REFUSED` | `from` | Sender refused |
| `KEY_REFUSED` | `api_key` | Key refused |
| `OVER_QUOTA` | `api_key` | Over today's quota (also a spent prepaid balance, a 402) |
| `UNAVAILABLE`, `TIMEOUT`, `MODEL_NOT_FOUND` | none: one line above the footer | |

### 6.4 Secrets

- Encrypted with AES-256-GCM under `ENCRYPTION_KEY`, with the additional data
  `integration_secret:<provider>:<key>`, so a ciphertext copied onto another row does not decrypt.
  `encryption.service` writes the bound form with a version prefix; rows written before it (the
  mailbox's passwords, an existing push pair) read as before.
- Never in a response, a log line, an audit row, an event payload, an error or a check's steps.
  The API answers `{ key, set, hint, set_by_name, set_at }`.
- `hint`: the last four characters of an API key; nothing of a password; a key pair shows its key id.
- Saving a secret, replacing one, removing saved settings and replacing push keys need a fresh
  sign-in (`security.assertFresh`: 403 `REAUTH_REQUIRED`, and the app's Confirm It's You).
- A secret field left empty keeps the saved one. A changed `host`, `port` or `username` on a
  connection whose password is saved needs the password in the same save (422 `SECRET_REQUIRED`:
  Type the password again); the test then uses the typed one.

### 6.5 Save

1. Validate the body against the provider's schema (`IntegrationSave`, keyed by `code`, which must
   match the path).
2. `saved_at` in the body must equal the stored one (null when nothing is saved), else 409
   `STALE`. Not `updated_at`: checks and counted use touch the row every few seconds.
3. The fresh sign-in when a secret is in the body; the destination rule (§6.4).
4. Test the typed values, using the saved secret where none was typed. Outside any transaction;
   every step has its own time limit (SMTP 15 s, TLS 10 s, Geoapify 4.5 s a call, Gemini 20 s) and
   a step after a failed one it depends on is skipped. A failure records the attempt and answers
   422 `TEST_FAILED` with the first failing step on its field (§6.3).
5. One transaction: upsert the connection (`configuration`, `saved_at`, `saved_by`, `daily_limit`),
   upsert each secret given (`hint`, `set_by`, `rotated_at`), record the check, set the state, and
   emit `integration.saved` with the configuration before and after and `secrets_replaced` naming
   the secret fields replaced.
6. After the commit, bump the version (§6.7).

### 6.6 Test, Send Test Email, Replace Keys

- Test runs the provider's steps on the settings in use and records a check of kind `test`. With
  nothing set up it answers a check with one step, `NOT_SET_UP`.
- Send Test Email renders `integration-test` to the tester's own work email (422 `NO_WORK_EMAIL`
  without one) through `system-mail.send()`, so it is paced (429 `MAIL_PACED` with the time a slot
  frees), routed and marked on staging like any other message, and counted. Its check has `connect`,
  `sign_in` and `send`.
- Replace Keys makes a new VAPID pair, stores it (`web_push`, `vapid`), records `integration.keys_replaced`
  and bumps the version; the old pair is gone.

### 6.7 A change reaches every process

`settings.of()` caches per process. Every read compares the version in Redis
(`<prefix>:integrations:version`, read at most once a second); a save, a removal and Replace Keys
increment it after their commit, so the API and the worker reload within a second. Without Redis the
cache lives 30 seconds. On a change:

- system mail builds a new SMTP transport and closes the old one;
- pacing reads the new hourly limit at the next message;
- the IDLE loop re-reads the staff mail server every 30 seconds and, on a change of host, port or
  live connections, closes its connections and opens them again within the new limit;
- the `mail-sync` scheduler ticks every minute and syncs every mailbox once `sync_every_min` minutes
  have passed since its last full pass;
- Geoapify, Gemini and web push read the key at their next call.

### 6.8 Mail with nothing set up (decision 4)

On a laptop or in CI system mail is captured in memory, as before. On staging and production
`send()` throws `MAIL_NOT_SET_UP` and the `email-send` job puts itself back for 15 minutes without
using an attempt, as it does at the hourly limit. The `mail` readiness check reads degraded, Not Set
Up. `config/env.js` no longer refuses to start a server without `SMTP_HOST` or `MAIL_SEND_PER_HOUR`;
it derives `MAIL_UNSET` (`capture` on laptops and in CI, `hold` on servers), so nothing outside it
reads `APP_ENV`.

### 6.9 Use and the daily limit

- `usage.record(code, kind, { ok, units, error_code })` adds to a counter in the process. Every 15
  seconds, and when the process stops, each counter is written with one upsert per connection, day
  (Lagos) and kind, adding its calls, failures and units. A crash loses at most 15 seconds of
  counts; nothing waits on the database to count.
- An answer served from a cache made no request and is not counted.
- A failure is the provider refusing or not answering: a network error, a timeout, a 5xx, a refused
  key, a 429. An address with no match is not a failure.
- The state follows the newest outcome, check or real call (`state_at` decides): a success sets
  `ok`; a failure sets `failing` with its code.
- When a flush takes today's units to 80% of `daily_limit` or more and `quota_warned_on` is not
  today, it sets `quota_warned_on` and emits `integration.quota_warning`.

### 6.10 Each environment keeps its own

Staging and production each have their own database and `ENCRYPTION_KEY` (A3): nothing saved on one
reaches the other. They share the mail host's limits, so each page holds its share: the no-reply
mailbox's 50 recipients an hour (40 and 10) and the host's 30 IMAP connections per IP address (24 and
4), as `dns-and-mail.md` §4 sets them.

### 6.11 An AI connection's model list, and each job's model

- **What is left off** (`ai-control.md` decision 29): besides models the ERP cannot use, each
  provider's `-latest` aliases, Gemma's open models, and a dated or numbered snapshot whose base
  model is on the same list (`-001`, `-09-2025`, `-2024-08-06`, `-20250929`). A model in a chain is
  kept whatever its name. Stored rows the rule leaves off go at the next save or test, and once by
  migration 10210.

- **Start**: `9291` seeds the models known on 20/10/2026 with what each does and its published list
  price; a price not known is null. A file key that has never been tested reads `available` null,
  which keeps its models usable.
- **Read with the key** (`services/ai/catalogue.js`, free): Gemini's from Google's own list (its
  display names and methods), the others from their OpenAI-compatible list, Anthropic's every page.
  A model the ERP has no use for is left off: speech or images out, video, live sessions,
  moderation; Anthropic's Opus and Fable never join (decision 3).
- **Kept** when the save's or the test's steps pass: listed models available, new ones added, the
  rest not available. A model added by hand with its own endpoint keeps its state: the provider's
  list cannot speak for it. A seeded or added model keeps its name; a listed one takes the provider's.
- **Each job's chain in code** (`services/ai/jobs.js`), until AI Control saves one for it
  (`ai-control.md` §6.1): Default and Image Reading the newest stable Gemini Flash; Fast the newest
  Flash-Lite; Deep Reasoning the newest Pro; Transcription Groq's `whisper-large-v3` (then turbo),
  then Gemini's Flash; Embeddings OpenAI's `text-embedding-3-small`; Top Tier Gemini's Pro, then
  Anthropic's newest Sonnet. A provider without a readable key, or a model the key's list no longer
  names, is passed over. With nothing on Gemini's list, the Default model is `GEMINI_MODEL`
  (`ai_setting.model` is no longer read).

### 6.12 Plans

- Every connection with a daily limit has a plan: the one saved here, else the registry's starting
  plan (Geoapify, Groq and Exchange Rates Free; Gemini, OpenAI, Anthropic and DeepSeek Paid).
- **Free** with a daily limit set: once today's units (written, plus what this process counted and has
  not written) reach the limit, the call is not made. Geoapify answers 429 `MAPS_BUSY`; the
  transcription chain passes to the next provider; the rate fetch records `OVER_QUOTA`. The answer is
  kept 10 seconds per connection.
- **Paid**: the limit only counts, and warns at 80% as before (decision 10); an AI provider does
  not warn (`ai-control.md` decision 26).

### 6.13 Exchange rates

- One request (`latest/USD`, the key as a bearer token, never in the address) brings every currency
  against the dollar. Each rate is kept as a decimal string, `numeric(24,10)`.
- The job fetches only while today's table (Lagos) is missing: about one request a day. A failure is
  tried again the next hour; Sync Rates always fetches.
- `shared/money/fx.js`: `rate(from, to, { day })` the newest table on or before the day, a pair
  without the dollar worked out through it; `convert(amount, from, to)` a Decimal; `newest()` the day,
  the dollar to naira rate and the currencies. An unknown rate is null.
- The `exchange_rates` readiness check is degraded when the newest table is more than 36 hours old.

### 6.14 Transcription

- The chain is the Transcription job's (§6.11). A provider is passed over when it is skipped until its
  reset (`services/ai/skips.js`, in Redis so every process agrees; at most a day), when its Free plan
  has reached its daily limit, or when it refuses, fails or takes more than 30 seconds.
- A refusal for quota or rate limit (429, or 402) marks it skipped for as long as it said
  (`retry-after`, Groq's reset headers, Google's RetryInfo), else a minute.
- Groq gets the original recording (WebM, Ogg, MP4 and the rest as they are); Gemini an MP3 of it at
  16 kHz mono (ffmpeg), with the prompt `voice-note-transcription` (word for word, the speaker's own
  words, no translation).
- Each attempt is a step of one AI run; Groq's seconds count toward its daily limit.
- None answered: the captions in the voice note's metadata come back as a draft
  (`Transcript.draft`), never stored; without them 503 `AI_UNAVAILABLE`. AI switched off still
  returns the captions. Nothing set up: the stub's placeholder, as a draft; one stored before this
  reads as no transcript.

### 6.15 Pausing system mail (§1.3)

- **Where it is kept**: `paused_at` and `paused_by` on the System Sender's `integration_connection`
  row, whatever its settings come from (saved or the server file). `settings.of("mail_sender")`
  carries `paused_at`; Pause and Resume bump the version (§6.7).
- **What it stops**: `system-mail.send()` throws `MAIL_PAUSED` before anything is rendered, routed,
  paced or counted, for every template but `user-invite`, `password-reset` and `integration-test`
  (`WHILE_PAUSED`). `sendPlain` (the server's health alarm) is not paused. A paused message takes
  no slot of the hourly limit, so an invitation is never queued behind it.
- **What each caller does with it**: `email-send` holds the job 15 minutes, tagged `held_for:
  pause`, until Resume promotes it; `notification-deliver` emails nothing and pushes each row that
  was due by email instead (`instead_of_email`, past the person's push switch for the category;
  not for a job more than a day old); the daily digest returns `mail_paused`, so the day's digest
  is dropped.
- **An invitation or a reset** is sent only while its link still works (`identity.linkStillOpen`):
  one replaced by a newer link, or expired while it waited, finishes with `link_closed`. This holds
  paused or not.
- **Status**: the `mail` readiness check reads `degraded`, mode `paused` ("Paused: invitations and
  password resets only"), which keeps a release ready. System Health tells nobody of it going down
  or coming back: the pause's own notice did.

### 6.16 Refused addresses

- **A refusal** is a 5xx answer to RCPT TO for every recipient (nodemailer's `EENVELOPE` with
  `rejected`): no such mailbox, a domain that takes no mail. cPanel's words are "The mail server
  could not deliver mail to … The account or domain may not exist". Some recipients refused while
  others took the message are kept the same way, and the message went.
- **Not a refusal**: a reply naming the host's own sending limit ("exceeded the max emails per
  hour", a sending quota, a rate limit). That is read as `MAIL_PACED` for an hour, so the job waits.
  A 4xx is a deferral, retried as before.
- **What happens**: the address is kept in `mail_refusal` (counted again when it is refused again),
  `send()` throws `MAIL_REFUSED`, and the job finishes without a retry: `email-send` and the digest
  return `refused`; `notification-deliver` marks that row done and carries on. One warning fault,
  "the mail server refused the recipient", counts every refusal on Faults and is never pushed.
- **Off the list**: when mail to the address is accepted, and after 30 days untouched
  (`integrations-purge`). Correcting a person's email is done in People; a sign-in email that was
  wrong when the login was made is corrected on the server (`docs/runbooks/dns-and-mail.md` §5).

## 7 · Events, jobs and notifications

| Event / job | When | Does |
|---|---|---|
| `integration.saved` | A save commits | Audit: the configuration before and after, `secrets_replaced`. Tells the other `integrations` view holders (Integration Changed). `mailbox_server`: the Mailbox handler re-points every mailbox and syncs it (§3 step 8). `mail_sender`: held mail promoted (§3 step 9) |
| `integration.removed` | Remove Saved Settings commits | Audit. Tells the other IT holders. `mailbox_server`: as for saved |
| `integration.keys_replaced` | Replace Keys commits | Audit. Tells the other IT holders |
| `integration.tested` | A Test or Send Test Email from the page | Audit only: who, which connection, the result |
| `integration.quota_warning` | The watch finds today's use at 80% of the daily limit, for a connection that is not an AI provider | Tells every IT holder (Daily Limit Near), once a day |
| `integration.mail_paused` | Pause Mail commits | Audit (paused before and after). Tells the other IT holders: "System mail paused", "Only invitations and password resets are sent." |
| `integration.mail_resumed` | Resume Mail commits | Audit. Tells the other IT holders: "System mail resumed". Outbox: promotes the `email-send` jobs held for the pause |
| `integrations-watch` (scheduler, every 15 minutes) | On schedule | Tests the free connections (§3 step 10) |
| `integrations-purge` (scheduler, 03:10 Lagos) | On schedule | Deletes checks older than 90 days and use older than 30 |
| `integration.model_added`, `integration.model_removed` | Add Model, Remove | Audit only; nobody is told |
| `exchange-rates` (scheduler, one minute past each hour, Lagos) | On schedule | Fetches today's rates while they are missing (§6.13) |
| Readiness `groq`, `openai`, `anthropic`, `deepseek`, `exchange_rates`, `web_push` (new); `ai` degraded while Gemini fails | Every readiness call and System Health's snapshot | Settings · Status shows every connection (decision 11) |
| Readiness `maps`, `mail_server` (new); `mail`, `ai` (now from the settings in use) | Every readiness call and System Health's snapshot | Settings · Status; `system_health.check_down` and `check_recovered` tell IT |

The `integration` events sit in the System Health category (`categories.js`): the bell and push for
IT, locked on, email off. Their audience is `integrations` view; the person who acted is not told.

## 8 · Permissions and visibility by role

| Role | Sees | Can do |
|---|---|---|
| Implementation Team | Everything on the page | View, edit, delete: save, test, send a test email, replace keys, remove saved settings |
| System Administrator | Everything on the page | The same |
| Operations & People, Management, Head of Department, Line Manager, Staff | Nothing: the tab is not in their Settings | |
| CEO | Everything, by the standing rule that the CEO passes every check | The same; never notified (the fan-out does not add the CEO to a permission audience) |

`integrations` is a module key in `shared/access/access.catalog.js`, area `system`, granted by
`9290` with view, edit and delete. Being a key and not a role test, a new IT hire is given it on
Settings · Roles & Permissions with no deploy. The tab shows only with `integrations` view
(`app/src/shell/access.ts` `visibleTabs`, mirrored for ⌘K by `src/shared/search/screens.js`
`tabVisible`).

No restricted fields: secrets never leave the server.

## 9 · AI and search

- **AI reads**: none (`// ai:none` in the controller). Keys and connections are configuration, and
  an assistant that could read them would be one more way for them to leak.
- **AI routes**: none.
- **Search**: the screen is found by its words (`shared/search/screens.js`): integration, connect,
  API keys, SMTP, mail server, no-reply, IMAP, Geoapify, maps key, address search, Gemini, AI key,
  web push, VAPID, Groq, Whisper, OpenAI, Anthropic, Claude, DeepSeek, AI models, Add Model, exchange
  rates, dollar rate, Sync Rates, free plan, paid plan. The record type `integration` is `search:none`
  in the route map: ten connections and their model lists, each found as the screen by its name.

## 10 · On screen and mobile

What each screen shows open, what sits behind help, and how it is laid out on a phone
(FRONTEND_GUIDE §5, §7). **§3 and §6 are for engineers: nothing in them reaches a screen unless it
is listed here as tier 1 or tier 2.** Tier 3 (how the system works, why it was built this way,
reassurance nobody asked for) is never on a screen; say where it lives instead (this guide, the
manual, the AI assistant). Both tables are read by `scripts/check/guides.js`.

### 10.1 Content tiers

| Screen | Open (tier 1) | Behind help (tier 2) | Not on screen (tier 3), lives in |
|---|---|---|---|
| Settings · Integrations (`integrations`) | Integrations as the title; the subtitle "Connected services and their keys" (desktop); KPI cards Working, Failing, Not Set Up; the group chips All, Mail, Maps, AI, Finance, Notifications; Connections, one row each (a card on a phone): its name, a state pill (Working, Failing, Not Checked, Not Set Up) with Paused beside it on the System Sender while system mail is paused, its source (Saved Here or Server File) or, when failing, the failure in a few words in its place (Password refused, Key refused, Not answering, Over today's quota, Saved key unreadable, Model not available), its plan pill (Free, Paid; desktop), its group, Checked with the time (day-first when not today), today's use against the daily limit (120 of 3,000) where one is set, and Test (edit); toasts "Test passed", "Test failed: Key refused" | Help term on Server File: "Set in the server's environment file. Saving here takes over from it." | Where values come from, the cache and the version, encryption, why a password shows no characters, what the watch probes: §3, §6 |
| A connection (side panel; a full-screen page on a phone) | Its name as the title, the state pill and the source; Settings: the values in use as label and value pairs, each secret as "Saved, ends 1a2b" (a key) or Saved (a password or a pair), with who set it and the day, or Not Set; Plan; for an AI connection In Use (each job and its model, "Transcription (Fallback): Gemini 3.8 Flash") and Models ("2 of 3 on this key"); for an AI connection the Models card: Search Models, each model's name with what it does and the jobs it does, On Key (Available, Not on Key, Not Checked), Price ("$0.30 / $2.50 per M", "$0.111 an hour", desktop), Add Model (edit) and, on a model added here, Remove (delete), 25 a page; for Exchange Rates the Exchange Rate card: One Dollar (₦1,534.21), Rates Of (the day), Currencies, and Sync Rates (edit); toasts "Rates synced", "Sync failed: Key refused", "Model added", "Model removed"; Remove Model confirms by name; for an AI connection Open AI Control (`ai_control` view); for the System Sender: while paused, a banner "Mail paused by Femi Bello, 21/10/2026 07:40", and Refused Addresses: Address, Person, Message (Invitation, Password Reset, Notice, Daily Digest, Report, Test Email), Last Refused, Times (desktop), 25 a page, No Refused Addresses when there are none; Pause Mail or Resume Mail beside Test (edit), toasts "Mail paused", "Mail resumed"; Test and Edit Settings at the foot, and behind More Actions (⋯) Send Test Email (System Sender), Replace Keys (Web Push) and Remove Saved Settings (Saved Here only); for Geoapify an Address field above the tests, prefilled; Last Test: each step with a tick or a cross, its name (Connect, Sign In, Send Email, IMAP, SMTP, Address Search, Address Lookup, Map Tile, Key, Answer, Keys, Test Push), its time, and the suggestions an address search found; Checks: when, kind (Save, Test, Test Email, Watch), result, by, 25 a page; Use: 7 days of calls and failures as bars with the daily limit; toasts "Test passed", "Test failed: Key refused", "Test email sent", "Keys replaced", "Settings removed"; Remove and Replace confirm by name (Remove Settings, Replace Keys) | Help terms: Server File ("Set in the server's environment file. Saving here takes over from it."), Daily Limit ("Your plan's allowance a day. IT is warned at 80%."; Groq's: "Seconds of audio a day, each request counted as at least ten."; the other AI connections': "Your plan's allowance a day."), Plan ("Free stops at the daily limit and the next provider answers. Paid only counts."), Rates Of ("Fetched after midnight, Lagos, each day."), Hourly Limit ("Recipients the mail host accepts an hour. Production and staging share the plan's 50."), Hourly Limit per Person ("Messages each person may send from their mailbox in an hour."), Local Domains ("Domains whose mailboxes are on this server, comma separated. Mail to them skips the route check."), Security, IMAP Host, SMTP Host and Sync Every (as on Edit Settings), Live Connections ("Mailboxes held open so new mail arrives at once. Production and staging share the host's 30."), Units on Use ("Geoapify counts credits: a search or lookup is one, four map tiles are one."), Mail paused ("Only invitations, password resets and test emails are sent. Notices reach people by push and the bell."), Refused Addresses ("Addresses the mail server would not take: no such mailbox, or a misspelt domain. Correct the email in People, or create the mailbox.") | What each step does on the network, which steps cost credits, how Replace Keys reaches devices, how a model list is read and kept, how each job's model is chosen, when rates are fetched, what a pause holds, drops and pushes, how a refusal is told from the host's limit: §3, §6.3, §6.6, §6.11, §6.13, §6.15, §6.16 |
| Edit Settings (form; a two-step wizard for the two mail connections) | System Sender, step Server: Server, Port, Security (TLS, STARTTLS), Username (Optional), Password; step Sending: From, Reply-To (Optional), Hourly Limit, Local Domains (Optional). Staff Mail Server, step Servers: IMAP Host (Optional), IMAP Port, SMTP Host (Optional), SMTP Port; step Limits: Hourly Limit per Person, Sync Every, Minutes, Live Connections. Geoapify, Gemini, Groq, OpenAI, Anthropic, DeepSeek and Exchange Rates: API Key, Plan (Free, Paid), Daily Limit (Optional). Web Push: Subject. A saved secret reads "Saved, ends 1a2b" or Saved with Replace, and Keep Saved puts it back (`SecretField`); Cancel, Back, Next, Save Settings; a refused field takes the wizard back to its step; field errors from §6.3 and "Type the password again"; toast "Settings saved" | Help terms: Security ("TLS from the first byte on 465; STARTTLS on 587."), IMAP Host and SMTP Host ("Blank uses each address's own domain."), Sync Every ("Minutes between syncs of every mailbox, behind live mail."), and Hourly Limit, Hourly Limit per Person, Local Domains, Live Connections and Daily Limit as on the connection | The test before save, the fresh sign-in and the destination rule: §6.4, §6.5 |
| Add Model (modal; a sheet on a phone) | Model ID, Name (Optional), Does (Text Only, Text and Images, Text, Images, Audio, Speech to Text, Embeddings), Endpoint (Optional); Cancel, Add Model; field errors "Not a model id", "Already on the list", "Sonnet or Haiku only", "Not an https address"; toast "Model added" | None | Where a model's list comes from and why Opus and Fable are left off: §1.2, §6.11 |
| Settings · Status (`status`) | Owned by System Health (`system-health.md` §10): the rows Maps and Staff Mail Server, and from PR1 Groq, OpenAI, Anthropic, DeepSeek, Exchange Rates and Web Push, like every check | As built there | §3 step 12 here |

### 10.2 Phone layout

| Screen | First on a phone | Left off a phone | Main action | Navigation |
|---|---|---|---|---|
| Settings · Integrations (`integrations`) | Two KPI cards, Working and Failing; the group chips; then each connection as a card: the name, the state pill (with Paused on the System Sender while mail is paused), and the source or the failure | The subtitle; the Not Set Up card; the plan, the group, Checked, today's use and Test on each card (all on the connection's page) | Tap a connection: its page opens full screen | Settings from More; the tabs scroll sideways along the top |
| A connection (full-screen sheet) | The state pill and the source; the System Sender's Mail paused banner while paused; Settings as label over value; for an AI connection the Models card as cards (the name with what it does, On Key); for Exchange Rates the Exchange Rate card with Sync Rates; Last Test with its steps; Use as bars | A model's price (on desktop); the Checks and Models lists page 25 at a time as cards; Remove on a model added here shows on a phone too (JBS Praxis, 26/10/2026) | Test, full width at the foot, with Edit Settings above it (and on the System Sender, Pause Mail or Resume Mail) and More Actions (⋯), an action sheet of Send Test Email, Replace Keys and Remove Saved Settings; Refused Addresses as cards (Times on desktop) | Close returns to Integrations |
| Edit Settings | A full-screen sheet: the step's title and fields (one step for the key connections and Web Push) | Nothing | Next, then Save Settings, full width at the foot | Close at the top; Back on the second step |
| Add Model | A sheet: Model ID, Name, Does, Endpoint | Nothing | Add Model, full width at the foot | Close at the top, or Cancel, returns to the connection |

## 11 · Edge cases

- **Redis down**: settings are read from the database at most every 30 seconds; counting does not
  need Redis; a save works and reaches the other process within 30 seconds.
- **A saved secret cannot be decrypted** (`ENCRYPTION_KEY` changed): `failing`, `SECRET_UNREADABLE`,
  "Saved key unreadable" on the card; the file is not used instead (§6.1); IT saves it again.
- **Two people save at once**: the second gets 409 `STALE` and reloads.
- **A test that hangs**: each step stops at its own limit and the whole test within 45 seconds; the
  button stays busy until then (F26).
- **Send Test Email in a full hour**: 429 `MAIL_PACED` with the time a slot frees. **No work email
  on the tester's record**: 422 `NO_WORK_EMAIL`.
- **Remove Saved Settings with no server file values**: the connection reads Not Set Up. For the
  system sender mail then waits (§6.8); the confirm says so in a line.
- **A mailbox mid-send during a server change**: a queued send uses the account's hosts when it is
  delivered, so after the move it goes through the new hosts.
- **Live connections lowered below those open**: the extra connections close at once.
- **Gemini key removed with no file key**: AI answers from the stub, as with no key before.
- **Geoapify key removed with no file key**: the maps stop (503 `MAPS_OFF`); address fields say
  Address search is unavailable and offer Use Current Location (`addresses.md` §6.5), never a typed address.
- **Push keys replaced**: a device subscribes again the next time the app starts; until then it gets
  no push. A device never opened again stays silent, as with any key change.
- **No daily limit set**: use is still counted; nothing warns.
- **A provider added to the registry later** appears as Not Set Up with no migration.
- **A model withdrawn by its provider** (Google limited the 2.5 models to existing projects): the next
  save or test marks it Not on Key, and each job moves to the next model its family ranks.
- **A key's list that names none of a connection's models**: the `models` step fails with
  `MODEL_NOT_FOUND` ("Model not available"), so the key is not saved.
- **Groq's free seconds used up mid-day**: Groq answers 429 with `retry-after`; voice notes go to
  Gemini until then, and the Free plan's own limit stops it before Groq refuses when it is set lower.
- **No exchange rate yet** (a new key, a failing fetch): the Exchange Rate card says No Rates Yet;
  `fx.rate()` answers null, and the readiness check reads degraded after 36 hours.
- **Add Model for Anthropic with an Opus or Fable id**: refused on the field, Sonnet or Haiku only.
- **Laptops and CI** run without network access to the providers: tests fake them, and unset mail is
  captured.

- **Paused with no sender set up**: nothing is sent either way; a message waits for the sender
  (`held_for: sender`) first, and for Resume once a sender is saved.
- **Pause Mail pressed twice, or by two people**: the second press changes nothing and tells
  nobody; both see Paused.
- **A notice written while paused, Resume pressed a minute later**: its email is not sent; it was
  pushed, and it is in the bell.
- **A scheduled report while paused**: it waits in its queue, re-asking every 15 minutes, and goes
  out on Resume within its hour's limit.
- **An invitation queued days ago**: sent only if its link still works; Resend Invitation replaces
  the link, so the old message is dropped and only the new one goes.
- **The host refusing every message for its hourly limit**: read as the hourly limit (wait an hour),
  never as refused addresses.
- **A refused address corrected in People**: the next message goes to the new address; the old one
  leaves Refused Addresses after 30 days.

## 12 · Donor code

None. The encryption service (`services/secrets/encryption.service.js`) came in at M0 and gains the
bound form here; nothing else is ported.

## 13 · Open questions

1. **Rotating `ENCRYPTION_KEY`**: a script that re-encrypts every stored secret (this page's, the
   mailbox passwords, the two-step keys) under a new key, reading the old one from a second
   variable. `key_version` exists for it. Not built here; GE and TB to decide.
2. **A second sender by purpose** (careers@, payroll@): the registry allows another `smtp`
   connection under its own code; nothing chooses between senders yet.
3. **Bounces on the no-reply inbox** (decision 1's fourth option, not chosen).
4. **Whether the 50 recipients an hour is per mailbox or for the hosting account**
   (`dns-and-mail.md` §4), which decides the two hourly limits. TB, 21/10/2026: the plan moves to
   10,000 an hour (Stellar Business); until then system mail can be paused (§1.3).
5. **The seeded model ids**: Gemini 3.8 Flash and 3.5 Flash-Lite and DeepSeek V4 Flash and Pro were
   named from Google's and DeepSeek's announcements, not read from a key; the first save of a real key
   confirms or marks them. Their prices are null until Find Prices (PR2) or IT fills them.
6. ~~Daily Limit Near for the AI providers~~: answered, it stops for them (`ai-control.md`
   decision 26, TB 20/10/2026).

## 14 · Change log

- 26/10/2026 · JP · From the User Guide audit's screen defects: Remove Model shows on a phone too (decided 26/10/2026), so a model added by hand can be removed there; when Confirm It's You replaced Edit Settings mid-save and the test then failed, what was typed (never a secret) and the marks are kept, and Edit Settings opens with them. §10.2 updated.
- 21/10/2026 · TB · §1.3, §6.15, §6.16 from TB's answers for the Milestone 1 handover: Pause Mail and Resume Mail on the System Sender (`integration_connection.paused_at`, `9230`); while paused only invitations, password resets, Send Test Email and the server's health alarm go out, notices are pushed instead, digests are dropped and other mail waits for Resume; a queued invitation or reset whose link stopped working is dropped; an address the mail server refuses for good is not retried, is one warning on Faults and is listed as Refused Addresses (`mail_refusal`, `GET /mail_sender/refusals`); a host over its own hourly limit is waited on for an hour. Settings · Status reads Mail as Paused without a check-down notice.

- 20/10/2026 · TB · §6.11: the model list leaves off `-latest` aliases, Gemma and snapshots whose base model is listed (`ai-control.md` decision 29).
- 20/10/2026 · TB · With AI Control (`ai-control.md`): an AI connection's In Use reads the chains in use, saved there or in code; each AI connection has Open AI Control (`ai_control` view); a link that names a connection (`?id=` its code) opens it, as AI Control · Models' Open Connection does.

- 20/10/2026 · TB · Daily Limit Near stops for the AI providers (`ai-control.md` decision 26): decision 10, §3 step 10, §6.12, §7 and the help terms on Daily Limit and Plan say so; open question 6 answered.
- 20/10/2026 · TB · Written from TB's twelve answers (§1.1), bringing Settings · Integrations (#77)
  forward from M9: mail, Geoapify, Gemini and web push settings move from the server file to the
  page, encrypted, tested before save and watched.
- 20/10/2026 · TB · Built (API, UI, mobile). Against the draft: `GET /summary` serves the cards, so
  they never count a filtered page; the list is one table (cards on a phone) with group chips rather
  than a title per group; a connection's secondary actions sit behind More Actions on both shells;
  the tests moved to the module (`integrations.testers.js`); the System Sender gained Local Domains
  (`SMTP_LOCAL_DOMAINS`, from main's route-check fix). New shared field `SecretField`; the shared
  side panel now keeps its footer in view when its body is long.
- 20/10/2026 · TB · §1.2 recorded: Groq, OpenAI, Anthropic, DeepSeek and Exchange Rates join Gemini,
  each AI connection gets a model list (seeded, read live from the key, Add Model), a Free or Paid
  plan, transcription by Groq then Gemini then the browser's captions, rates daily at midnight with
  Sync, every connection on Status. Built in PR1; the sections below follow as it is built.
- 20/10/2026 · TB · PR1 built (API, UI, mobile): §2 to §11 brought up to it: the model lists (`ai_model`,
  `9210`, `9291`), plans, Add Model, the exchange rates (`exchange_rate`, `9220`, `shared/money/fx.js`,
  the `exchange-rates` job, Sync Rates), the Free plan's stop, each job's model until AI Control, the
  readiness check of every connection, and voice notes through Groq, then Gemini, then the browser's
  captions. The new providers have no server-file fallback.
- 20/10/2026 · TB · Every address field now searches from the second character and names a pin through `GET /maps/pin` (`docs/guides/addresses.md`), each counted here as a search or a lookup; answers kept in memory and in Redis spend nothing. The Geoapify test's Address stays a plain field, marked `address:none` (the text the test searches once; gate 22), and its body's `address` is marked the same in the contract.
