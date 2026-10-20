# CLAUDE.md · MyCity App ERP

You are working in the MyCity App ERP repository, built by JBS Praxis for MyCity App Ltd (Lagos):
an Express + PostgreSQL backend with a worker, a staff React app (`app/`, `hub.mycityapp.io`) and a
separate public React app (`public-app/`, `go.mycityapp.io`). Milestones M0 to M11, 9 October to
18 December 2026.

You will not read the whole repository, and you must not guess how it is written. The documents
below are how you learn it. **Follow the steps in order on every task.**

---

## Step 1 · Classify the task

| Type | It touches |
|---|---|
| **Backend** | `src/`, `migrations/`, `seeds/`, `scripts/`, `packages/contract/`, `templates/` |
| **Frontend** | `app/`, `public-app/`, `packages/ui/` |
| **Full stack** | Both. Most screen work is full stack |
| **Docs only** | `docs/`, `README.MD`, this file |
| **Ops** | `ops/`, `.github/workflows/`, `scripts/deploy/` |

State the type in your first message ("This is a full-stack change to My Attendance").

## Step 2 · Read before you write

**Always, whatever the type:**

1. `docs/PROGRESS.md`: find the screen(s) or foundation item. Note the row number and status.
2. `docs/guides/<module>.md` if it exists: the screens this feature touches and how they relate.
   Guides are **full-stack** (backend, schemas, API, events, permissions and screens): read all of
   it, whatever the task type. If your task changes behaviour the guide describes, **update the
   guide first** and say so.
3. The milestone's section of `docs/MyCity-ERP-Documents/MILESTONES.md`.

**Then by type:**

| Type | Read |
|---|---|
| Backend | `docs/BACKEND_GUIDE.md` in full. Then the sections of `docs/BACKEND_STRUCTURE.md` it points to for what you are touching. `README.MD` §4 to §7 for where files live and the rules. For a migration or a reference seed, `docs/DATABASE_SCHEMA.md` (what exists and what your milestone owes) and `docs/MIGRATIONS.md` in full |
| Frontend | `docs/FRONTEND_GUIDE.md` in full, `docs/FRONTEND_FOUNDATION.md` (decisions F1 to F27, binding) and `docs/COMPONENTS.md` (every shared component; open them in `npm run gallery`). The feature guide's **§10 On screen and mobile** for what each screen shows open, behind help and on a phone. The screen in `docs/MyCity-ERP-Documents/demo.html` for look only |
| Full stack | Both guides. **Contract first**: write or change `packages/contract/schemas/<module>.js`, then the backend, then the frontend against the generated types |
| Docs only | The document you are changing, and anything it cross-references |
| Ops | `docs/SYSTEM_ARCHITECTURE.md` §1, §2, §9, §10, §11, and `docs/runbooks/` |

Donor code to port from lives in `C:\praxis-ls` and `C:\pixie-girl-hub`. `docs/MyCity-ERP-Documents/REUSE_MAP.md`
says which file each piece comes from and what changes on the way in. **Ported code never says where
it came from**: no project names, paths or "ported from" in code, comments, tests or config. A comment
says what the code does and why. `scripts/check/provenance.js` fails the build otherwise.

## Step 3 · Which document wins

1. `MILESTONES.md` is binding for scope and decisions A1 to A26.
2. `REUSE_MAP.md` wins over `MILESTONES.md` where they disagree.
3. For the frontend foundation (`packages/ui`, tokens, shared components, the app shells and the
   frontend gates), decisions F1 to F27 in `docs/FRONTEND_FOUNDATION.md` §3 win over
   `MILESTONES.md`, `FRONTEND_GUIDE.md` and `demo.html` (decided with TB, 15/10/2026).
4. `SYSTEM_ARCHITECTURE.md`, `BACKEND_STRUCTURE.md`, then the backend and frontend guides.
5. `README.MD` is the map of every file.
6. `demo.html` is a visual reference only. Never take data, field names or rules from it.

If two documents disagree in a way that matters to your task, stop and say so. Do not pick one
silently.

## Step 4 · Rules you never break

- **Pagination: 25 per page, server side, everywhere.** Lists go through
  `src/shared/http/paged.js` (`pageQuery`, `sendPaged`). No `LIMIT`/`OFFSET` in a repo, no
  page-size parameter in the contract or the frontend. The AI reads in pages of 25 too.
- **AI reads, never writes** (A23). Manifests declare reads and screen routes only.
- **Every AI feature names its job** (`docs/guides/ai-control.md` §6.2: Default, Fast, Deep
  Reasoning, Image Reading, Transcription, Embeddings, Top Tier). Before building one, ask the person
  which job it uses, your recommendation first, and register the action with who chose it. Top Tier
  is only for long drafting from many sources, never work Default or Deep Reasoning can do. No
  personal data goes to DeepSeek. Permissions are checked by code, never by a model.
- **One write path**: every write goes through the owning module's service, in a transaction,
  with `emit()`. Follow-on work is an outbox handler.
- **Contract**: every request and response shape is a Zod schema in `packages/contract`,
  `snake_case`. Never edit `contract.gen.ts`. The frontend declares no Zod of its own.
- **Money** through `shared/money`, `numeric(18,2)`, strings on the wire. **Dates** ISO on the
  wire, day-first for people. **Numbers** from `numbering.allocate()`.
- **Files** through the upload engine and the vault; store a `document_id`.
- **No second copy of a shared concern** (mailer, money, dates, file store, pager, AI client).
- **Permissions** on every staff route; repos honour scope; public routes never import auth.
- **No login without an employee.** Accounts are created with a full employee record
  (`scripts/db/create-admin.js` for the first one, the app for everyone else).
- **Production is never seeded** with demonstration data. The one exception is MyCity's real staff
  (`seeds/staff/`), loaded on staging and production by each deploy (TB, 16/10/2026;
  `docs/guides/foundation.md` §6.1). Nothing on a screen is hard-coded data.
- **Search reaches everything.** Every new screen, action and record type is findable from ⌘K
  (its module's `.search.js`, the route map, the screen's New action), or carries
  `search:none <reason>`; the search coverage gate fails it otherwise (`docs/guides/foundation.md` §6.7).
- **Addresses are picked, never typed** (F27, gate 22; TB, 20/10/2026). Every address or location a
  person enters, on hub and go, live and staging, is an `AddressField` (a `PlacesField` for a list
  of cities) bound to the contract's `PlaceInput` and saved with `places.save()` in the owning
  service. The API takes only a place our search or pin signed, or the device's location while
  address search is down. No free address field, anywhere; a new one is a new owner
  (`docs/guides/addresses.md` §6.9).
- **Three tiers of screen text** (FRONTEND_GUIDE §5, gate 8). Operational content is open. Support
  text sits behind a help term (hover on desktop, tap on a phone) or a Details row, closed by
  default. How the system works or why it was built never reaches a screen: no explainer cards
  (titles starting How, Why, What), no footnotes, no reassurance lines, no text in modal footers.
  A feature guide's §3 and §6 are for engineers; only what its §10 lists reaches a screen.
- **Word limits are numbers, not judgement** (`scripts/check/lib/copy.js`): page title 3, subtitle
  8 and desktop only, card title 4, button 3, toast 8, help 35, any sentence 20, first phone screen
  40. Title Case chrome, Verb Noun buttons, Lucide icons, no em dashes in copy a person reads.
- **Two shells** (gate 11): mobile is a native-feeling app (bottom bar, cards not tables, sheets,
  44 px targets, less text), desktop is desktop software. Never one layout scaled.
- **Components only from `@mycity/ui`** (`packages/ui`, listed in `docs/COMPONENTS.md`). A missing
  one is added in `packages/ui` with `npm run new:component` (header, test and gallery page), never
  inside a feature; nothing new goes in `app/src/components/` or `public-app/src/components/`.
- **Styling is tokens only** (F4): token classes and the named layout and spacing scales. No hex,
  no arbitrary value, no inline `style`. Colours exist only in `packages/ui/src/styles/tokens.css`.
- **Nothing the browser styles itself** (F25, gate 21, no exemptions): no native `<select>` or
  phone picker, no browser date, number, checkbox or radio input, no `title` tooltip, no validation
  bubble, no toast outside the branded `Toaster`. Selects are `SelectField`/`FilterSelect`/
  `InlineSelect` (`SelectMenu`), hover labels are `Tooltip`. FRONTEND_GUIDE §8.8 has the full list.
- **The mock never ships** (F12 to F14): the in-browser mock is for laptops and CI only, never in a
  release build. Staging shows its seed, production only live data.
- **One press, one request** (F26): a button's handler hands back its work (`onClick={save}`),
  never `() => void save()`; the button spins and refuses a second press until it settles, and the
  buttons beside it wait (`ActionGroup`; modals, forms and footers already are one). Never
  `disabled={busy}`. The lint rule `mycity/no-void-press` refuses it (FRONTEND_GUIDE §8.4).
- **One form system** (gate 12): fields only from `packages/ui/src/form/` (`useContractForm` with the
  module's schema, or INTERIM rules until it exists), labels above, Optional tags, errors of at
  most 4 words on the field as it is filled, buttons only in a footer. Nobody builds their own field.
- **Migrations**: in your milestone's number block, `-- UP` and `-- DOWN`, idempotent, never edit
  a merged one, and every rule in `docs/MIGRATIONS.md` (match the code that writes the table; seeds
  hold only what A26 allows).

## Step 5 · Finish

A Stop hook (`.claude/hooks/stop-check.js`) runs `check/progress.js`, `check/guides.js` and
`check/readme-map.js` when you try to finish. If they fail you are sent back with the reasons;
fix them rather than arguing with them. If one genuinely does not apply (a refactor that moves no
screen, a test-only change), say so to the user and give the PR line to use:
`Progress-unchanged: <reason>` or `Guide-unchanged: <reason>`. CI runs the same checks on every PR.
When your change touches `packages/ui/`, `app/`, `public-app/` or `demo.html`, the hook also runs
the screen gates (`components`, `palette`, `forms`, `dashes`, `five-second`, `two-shells`, `native-ui`); they have
no exemption line. Fix the screen.

A task is not finished until:

1. `npm run ci` passes, the whole suite.
2. **`docs/PROGRESS.md` is updated**: tick API, UI or Mobile on each screen you completed, set
   Status and Updated (day-first date), update the summary counts if a Status changed, and add a
   note under the module: date · initials · what was done · what is left. For foundation work,
   tick the M0 item and add a note there.
3. The feature guide matches what you built.
4. `README.MD` lists any new file you created (README §11).
5. A finished module keeps no empty files: delete its stubs that stayed empty and take them off
   `README.MD` and the guide (README §11.5). Stubs a later milestone fills stay.
6. For a frontend change, the PR body's **Native app feel** section says what you did on the phone
   and desktop shells (gate 11). No screenshots needed.
7. Your final message lists what changed, what is left, and anything you could not verify.

## Working conventions

- Branch `m<N>/<short-name>`. PR titles in Conventional Commits form. One approving review, not
  the author. Merges to `main` deploy to staging; production waits for a person's approval.
- Do not commit, push or open a PR unless asked.
- Open a PR as a draft while the work goes on: a draft runs no CI on GitHub, so `npm run ci` runs
  locally; mark it ready for review once that is green (BACKEND_GUIDE §8.4).
- Ask only when a decision genuinely blocks the work; otherwise state the assumption you made.
- When you do ask a question or surface a decision, use the AskUserQuestion tool, not prose, unless
  the person asks for the answer in chat or requests Markdown. Always include a recommendation: put
  the recommended option first and mark it `(Recommended)`.

Team: GE Godwin-Okoh Elisha (architecture, M0, M3, M7, M9, community and mailbox) · TB Tom-Blake
Asaah (Home, M4, M10, M11) · LA Love Adeola (migrations and data, attendance, M5, M6) · AJ Adole
Jerome (frontend foundation, ESS, M2, M8).
