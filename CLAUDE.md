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
| **Frontend** | `app/`, `public-app/` |
| **Full stack** | Both. Most screen work is full stack |
| **Docs only** | `docs/`, `README.MD`, this file |
| **Ops** | `ops/`, `.github/workflows/`, `scripts/deploy/` |

State the type in your first message ("This is a full-stack change to My Attendance").

## Step 2 · Read before you write

**Always, whatever the type:**

1. `docs/PROGRESS.md`: find the screen(s) or foundation item. Note the row number and status.
2. `docs/guides/<module>.md` if it exists: the screens this feature touches and how they relate.
   If your task changes behaviour the guide describes, **update the guide first** and say so.
3. The milestone's section of `docs/MyCity-ERP-Documents/MILESTONES.md`.

**Then by type:**

| Type | Read |
|---|---|
| Backend | `docs/BACKEND_GUIDE.md` in full. Then the sections of `docs/BACKEND_STRUCTURE.md` it points to for what you are touching. `README.MD` §4 to §7 for where files live and the rules |
| Frontend | `docs/FRONTEND_GUIDE.md` in full. The screen in `docs/MyCity-ERP-Documents/demo.html` for look only |
| Full stack | Both guides. **Contract first**: write or change `packages/contract/schemas/<module>.js`, then the backend, then the frontend against the generated types |
| Docs only | The document you are changing, and anything it cross-references |
| Ops | `docs/SYSTEM_ARCHITECTURE.md` §1, §2, §9, §10, §11, and `docs/runbooks/` |

Donor code to port from lives in `C:\praxis-ls` and `C:\pixie-girl-hub`. `docs/MyCity-ERP-Documents/REUSE_MAP.md`
says which file each piece comes from and what changes on the way in.

## Step 3 · Which document wins

1. `MILESTONES.md` is binding for scope and decisions A1 to A25.
2. `REUSE_MAP.md` wins over `MILESTONES.md` where they disagree.
3. `SYSTEM_ARCHITECTURE.md`, `BACKEND_STRUCTURE.md`, then the backend and frontend guides.
4. `README.MD` is the map of every file.
5. `demo.html` is a visual reference only. Never take data, field names or rules from it.

If two documents disagree in a way that matters to your task, stop and say so. Do not pick one
silently.

## Step 4 · Rules you never break

- **Pagination: 25 per page, server side, everywhere.** Lists go through
  `src/shared/http/paged.js` (`pageQuery`, `sendPaged`). No `LIMIT`/`OFFSET` in a repo, no
  page-size parameter in the contract or the frontend. The AI reads in pages of 25 too.
- **AI reads, never writes** (A23). Manifests declare reads and screen routes only.
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
- **Production is never seeded.** Nothing on a screen is hard-coded data.
- **Long text behind an ⓘ icon button**, inline. No prose walls. Title Case chrome. No em dashes
  in copy a person reads.
- **Two shells**: mobile is its own layout (bottom icon navigation, less text), not desktop shrunk.
- **Migrations**: in your milestone's number block, `-- UP` and `-- DOWN`, idempotent, never edit
  a merged one.

## Step 5 · Finish

A Stop hook (`.claude/hooks/stop-check.js`) runs `check/progress.js`, `check/guides.js` and
`check/readme-map.js` when you try to finish. If they fail you are sent back with the reasons;
fix them rather than arguing with them. If one genuinely does not apply (a refactor that moves no
screen, a test-only change), say so to the user and give the PR line to use:
`Progress-unchanged: <reason>` or `Guide-unchanged: <reason>`. CI runs the same checks on every PR.

A task is not finished until:

1. `npm run ci` passes, the whole suite.
2. **`docs/PROGRESS.md` is updated**: tick API, UI or Mobile on each screen you completed, set
   Status and Updated (day-first date), update the summary counts if a Status changed, and add a
   note under the module: date · initials · what was done · what is left. For foundation work,
   tick the M0 item and add a note there.
3. The feature guide matches what you built.
4. `README.MD` lists any new file you created (README §11).
5. Your final message lists what changed, what is left, and anything you could not verify.

## Working conventions

- Branch `m<N>/<short-name>`. PR titles in Conventional Commits form. One approving review, not
  the author. Merges to `main` deploy to staging; production waits for a person's approval.
- Do not commit, push or open a PR unless asked.
- Ask only when a decision genuinely blocks the work; otherwise state the assumption you made.

Team: GE Godwin-Okoh Elisha (architecture, M0, M3, M7, M9, community and mailbox) · TB Tom-Blake
Asaah (Home, M4, M10, M11) · LA Love Adeola (migrations and data, attendance, M5, M6) · AJ Adole
Jerome (frontend foundation, ESS, M2, M8).
