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
4. The User Guide chapter for the screens you touch, `docs/manual/<chapter>.md` (what a person is
   told to press and see there), and `docs/manual/README.md` before you write one. If your task
   changes what a screen shows or does, the chapter changes with it.
5. `docs/handoff/`: a handoff for the work, its module or its branch (each names its branch and
   owner in its header). If one exists, read it in full before you write any code: its decisions
   are not re-opened, its checklist says where the work stands and what comes next, and you tick
   it and add to its log as you go.

**Then by type:**

| Type | Read |
|---|---|
| Backend | `docs/BACKEND_GUIDE.md` in full. Then the sections of `docs/BACKEND_STRUCTURE.md` it points to for what you are touching. `README.MD` §4 to §7 for where files live and the rules. For a migration or a reference seed, `docs/DATABASE_SCHEMA.md` (what exists and what your milestone owes) and `docs/MIGRATIONS.md` in full |
| Frontend | `docs/FRONTEND_GUIDE.md` in full, `docs/FRONTEND_FOUNDATION.md` (decisions F1 to F32, binding) and `docs/COMPONENTS.md` (every shared component; open them in `npm run gallery`). The feature guide's **§10 On screen and mobile** for what each screen shows open, behind help and on a phone. The screen in `docs/MyCity-ERP-Documents/demo.html` for look only |
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
   frontend gates), decisions F1 to F32 in `docs/FRONTEND_FOUNDATION.md` §3 win over
   `MILESTONES.md`, `FRONTEND_GUIDE.md` and `demo.html` (decided with TB, 15/10/2026).
4. `SYSTEM_ARCHITECTURE.md`, `BACKEND_STRUCTURE.md`, then the backend and frontend guides.
5. `README.MD` is the map of every file.
6. `demo.html` is a visual reference only. Never take data, field names or rules from it.

If two documents disagree in a way that matters to your task, stop and say so. Do not pick one
silently.

## Step 4 · Rules you never break

- **Pagination: 25 per page, server side, everywhere.** Lists go through
  `src/shared/http/paged.js` (`pageQuery`, `sendPaged`). No `LIMIT`/`OFFSET` in a repo, no
  page-size parameter in the contract or the frontend. The AI reads in pages of 25 too. A select
  filled from a server list loads its next 25 as its menu nears its end (`useInfinite` with
  `paging`, F32), never one page cut short.
- **AI reads; it acts only through a declared action a person confirms** (A23 as amended
  01/11/2026, `docs/guides/praxis-ai.md` §1.2). Manifests declare reads, summaries, actions and
  screen routes; an action's `run` is the module's own service function, never SQL; the model
  proposes, the server decides, the person presses. Gate 19 refuses anything else, gate 23 keeps
  the engine told of every schema change (`docs/handoff/praxis-ai-engine.md` §7).
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
- **The User Guide follows the screens** (JBS Praxis, 25/10/2026; `docs/guides/user-guide.md`). A
  change to a screen a chapter of `docs/manual/` covers changes the chapter in the same PR, and its
  pictures are retaken (`npm run guide:shots -- --stale`); a new screen of a delivered milestone
  gets its section. Steps name buttons in bold exactly as the screen reads them and link the screen;
  a step needing a grant says so (`needs`), so a reader without it never receives it.
  `check/user-guide.js` fails it otherwise; `User-guide-unchanged: <reason>` only when nothing a
  person sees changed. A stale picture has no exemption.
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
- **A record opens in a sheet, never below its list** (F31, gate 11; JBS Praxis, 25/10/2026). On a
  phone a tapped row opens its record in a bottom sheet and nothing opens until a row is tapped; on
  desktop the list and the record sit side by side. A list and the record it opens are always
  `ListDetail` from `@mycity/ui` (`DetailPane` where desktop puts the record elsewhere). The gate
  taps each phone screen's rows and has no exemption. Expenses records open in the modal on desktop
  too (F31 amended 04/11/2026, AJ; `docs/guides/expenses.md` §10), and so do Recruitment's Interviews
  and Offers, in the widest dialog (F31 amended 08/11/2026, GE); its Candidates, Assessments
  and Onboarding, in the wide dialog (F31 amended 11/11/2026, GE; a vacancy is a page of its own); and both payslips,
  Payroll · Payslips and ESS · My Payslips (F31 amended 11/11/2026, JBS Praxis; `docs/guides/payroll.md` §10.3).
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

A Stop hook (`.claude/hooks/stop-check.js`) runs `check/progress.js`, `check/guides.js`,
`check/readme-map.js` and `check/user-guide.js` when you try to finish. If they fail you are sent
back with the reasons; fix them rather than arguing with them. If one genuinely does not apply (a
refactor that moves no screen, a test-only change), say so to the user and give the PR line to use:
`Progress-unchanged: <reason>`, `Guide-unchanged: <reason>` or `User-guide-unchanged: <reason>`.
CI runs those checks on every PR, and many more (see "The gates behind `npm run ci`" below).
When your change touches `packages/ui/`, `app/`, `public-app/` or `demo.html`, the hook also runs
the screen gates (`components`, `palette`, `forms`, `dashes`, `five-second`, `two-shells`, `native-ui`); they have
no exemption line. Fix the screen. The hook is a fast subset: it leaves the slow gates (`a11y`,
`mock-free`, the frontend tests and builds, the backend suite) to `npm run ci`, so a clean Stop is
not a green PR.

A task is not finished until:

1. `npm run ci` passes, the whole suite, on Node 20 (below). A gate you could not run here is named
   as unverified in your final message.
2. **`docs/PROGRESS.md` is updated**: tick API, UI or Mobile on each screen you completed, set
   Status and Updated (day-first date), update the summary counts if a Status changed, and add a
   note under the module: date · initials · what was done · what is left. For foundation work,
   tick the M0 item and add a note there.
3. The feature guide matches what you built, and so does the User Guide chapter (`docs/manual/`),
   its pictures retaken.
4. `README.MD` lists any new file you created (README §11).
5. A finished module keeps no empty files: delete its stubs that stayed empty and take them off
   `README.MD` and the guide (README §11.5). Stubs a later milestone fills stay.
6. For a frontend change, the PR body's **Native app feel** section says what you did on the phone
   and desktop shells (gate 11). No screenshots needed.
7. Your final message lists what changed, what is left, and anything you could not verify.

### The gates behind `npm run ci`

`GATES` in `scripts/ci-local.js` is the list, and the only one that stays current;
`npm run ci:list` prints it. Steps 1 to 4 name the gates whose rule is written there (`pagination`,
`search-coverage`, `ai-no-writes` and `ai-awareness` among them). These are the rest:

| Group | Gates (id) and what they refuse |
|---|---|
| Backend (needs PostgreSQL with pgvector, Redis, ffmpeg) | `test` (the whole jest suite) · `migration-numbers` · `migration-reversibility` (a DOWN, or the reason there is none, and the round trip runs) · `migration-idempotency` · `schema-drift` · `contract-columns` (contract keys are columns) · `route-contracts` (write routes validated) |
| Frontend | `fe-typecheck` · `fe-lint` · `fe-test` · `fe-build` (gallery, app, public site) · `mock-free` (a release build carries no mock, F12 to F14) |
| Screens (Chromium) | `five-second`, `two-shells`, `native-ui` (above) · `a11y`: **any** axe violation fails, whatever its impact, colour contrast included, on every gallery component page (390 and 1440 px, light and dark) and every staff-app screen (390 and 1440 px). Fix it in the component or the screen, never by turning a rule off (F7) |
| Rules | `contrast` (gate 14: every text and surface token pair keeps 4.5:1 in light, dark and device dark; a token and its pair in `packages/contract/schemas/appearance.js` change together) · `date-format` (15) · `native-dialogs` (16) · `upload` (18) · `money` (20) · `ai-manifest-coverage` (9) · `ai-engine-boundary` (24) |
| Pipeline guards | `contract`, `components-catalogue`, `env-template` (each generated file is current) · `module-catalogue` · `capabilities` · `public-surface` · `numbering-schemes` · `schedulers` (every scheduler is started) · `production-environment-refs` (only release and rollback reach production) · `ai-vendor-imports` · `ai-actions` · `shell` (LF and parses) |
| Process | `codeowners`: every line of `.github/CODEOWNERS` has two or more owners (the author's own approval does not count), every path it names exists, and every folder in `src/modules/` and every guide in `docs/guides/` has its own line. A new module or guide adds its line in the same PR |

How CI differs from your laptop:

- **Node 20.** `.nvmrc` names it and `npm run ci` exits 2 on any other major. A cloud session's start
  (`.claude/hooks/session-start.sh`) puts `/opt/node20` first. Where the image has none,
  `npm install node@20` into a scratch folder and put its `node_modules/.bin` first on `PATH`.
- **pgvector.** The backend gates need PostgreSQL with pgvector. `extension "vector" is not
  available` means this database lacks it, and `migration-reversibility` and every integration file
  fail on it. Where that is the only error, it is the container and not your change, but it is not
  a pass either: list those gates as unverified and read the PR's backend jobs.
- **Scope.** In GitHub, `scripts/check/lib/scope.js` decides how much a run needs. A change to
  documents only (Markdown at the root, in `docs/` or directly in `.github/`, except
  `docs/PROGRESS.md` and `MILESTONES.md`, which code reads) runs only the document gates
  (`dashes`, `components-catalogue`, `components`, `progress`, `guides`, `readme-map`, `codeowners`,
  `user-guide`). A PR that changes code runs only the sets its files can affect: a change under
  `app/` skips the backend jobs and the gallery screens. A push to `main` whose tree a PR's full run
  already passed runs the document gates only. A skipped job is not a pass of its gates, and a
  laptop always runs everything.
- **Strict in CI.** With `CI_STRICT=1` a gate whose script is an empty file ("NOT BUILT") fails the
  run; locally it is reported and does not.
- **Generated files are regenerated, never merged by hand.** On a merge conflict in one, take either
  side, run its generator (after `npm ci`, if `node_modules` is empty) and commit the result:
  `contract.gen.ts` and `contract.gen.meta.json` (`npm run gen:contract`), `docs/COMPONENTS.md`
  (`gen:components`), `.env.example` (`gen:env`), `src/shared/ai/catalogue.snapshot.json`
  (`gen:ai-catalogue`, gate 23). Each has a `--check` that CI runs.
- **One gate, or one job's gates.** `npm run ci -- --only=a11y,contrast` runs the gates named (by
  id); `--group=backend|frontend|screens|checks` runs a CI job's. Never run two screen-gate runs at
  once: they share one demo build (the Stop hook already stands aside while `npm run ci` runs).

## Training and handover videos

Asked for a milestone's training or handover video ("make the Milestone 6 video")? Read
`docs/runbooks/training-videos.md` in full first. It holds the pattern every video follows (measured
from the M3 video), the tooling in `scripts/video/`, how to film, the pitfalls met and where the work
stands. Bugs found while filming are fixed in the same branch and logged there (§7).

## Working conventions

- Branch `m<N>/<short-name>`. PR titles in Conventional Commits form. No approving review is
  required (JBS Praxis, 24/10/2026): a PR merges once CI is green, and its author merges it.
  Merges to `main` deploy to staging; production waits for a person's approval.
- Do not commit, push or open a PR unless asked.
- Open a PR as a draft while the work goes on: a draft runs no CI on GitHub, so `npm run ci` runs
  locally; mark it ready for review once that is green (BACKEND_GUIDE §8.4).
- Ask only when a decision genuinely blocks the work; otherwise state the assumption you made.
- When you do ask a question or surface a decision, use the AskUserQuestion tool, not prose, unless
  the person asks for the answer in chat or requests Markdown. Always include a recommendation: put
  the recommended option first and mark it `(Recommended)`.
- **Work in the foreground, and stay fast.** Read, search and edit in the session itself, and send
  independent tool calls together so they run at once. Spawn subagents only when the work is too
  broad for one context or gains real coverage from parallel readers (a whole-module audit, a sweep
  of large transcripts); then start them together in one message, in the foreground
  (`run_in_background: false`), and bring their findings into the chat. Never run the same search
  here and in an agent. A background agent or a Workflow is for work long enough that waiting would
  block the person; say so when you start one. Slower in the foreground is fine; work lost with a
  session that ends is not.
- **Plan first, then one chat a PR** (TB, 11/11/2026). A milestone, or any change cut into more
  than one PR, is planned in its own planning chat on the most capable model available, at high
  effort: never on a lighter model. The plan lives in the module's guide (its build plan appendix)
  and names, for each PR, its scope and size, the model and effort to build it on, which PRs can
  run in parallel and the order they merge in (for example "merge PR 3 before PR 5"), so parallel
  work never conflicts. Each PR is then built in a **fresh chat** from the start prompt the
  planning chat gives for it, so it carries only what that PR needs; the planning chat is asked
  for the next prompt when a PR merges. A chat whose context is filling up (past about three
  quarters) is closed and its next step started fresh from the guide and the handoff.
- **Research has sources** (TB, 11/11/2026). A figure taken from law or from outside the
  repository (a tax band, a statutory rate, a legal threshold) is researched in a session whose
  environment allows network access (switched off again afterwards), from the primary text, and
  is written down with its source (the instrument, the section, a link or the document, the date
  checked). Nothing comes from memory or a model's guess. A figure with no legal source says so
  in plain words ("no legal source: a company rule"). A source that changes is entered again by a
  person; nothing updates a legal figure by itself.

Team: GE Godwin-Okoh Elisha (architecture, M0, M3, M4, community and mailbox) · TB Tom-Blake
Asaah (Home, M6, M9, M10, M11) · LA Love Adeola (migrations and data, attendance, M7) · AJ Adole
Jerome (frontend foundation, ESS, M2, M5, M8).
