## feat(m5): offers to hired, documentation and onboarding (PR 5 to 8), with the fixes from the audit of 12/11/2026

M5 from the candidate's signature to their first day, and the 22 gaps its audit found, fixed on `m5/offers`. The design is `docs/guides/offers.md`; the build plan and its log are `docs/handoff/m5-offers-onboarding.md`. PR 0 to 4 merged in #85.

### What this PR holds

**PR 5 · Acceptance to hire.** The candidate's signature runs one transaction (`offers.acceptedIn`): the offer accepted, the employee created without a seat or a login, the card moved to Documentation, the onboarding case opened with its checklist, and the employment contract generated (CON) with its request opened company first, hire second. The candidate's sealed offer comes as `offer-signed` with the copy; Sign for Company mails the hire `contract-sent`.

**PR 6a · Onboarding to the documentation gate.** Checklist and Plans settings (MyCity's New Joiner list and Your First 30 Days seeded once, 5399), the Upload Documents link and page API (privacy notice first, files on the employee record and scanned, typed values, two guarantors with reference checks, the BVN), verify and reject, and the gate to Pre-Onboarding.

**PR 6b · Onboarding to hired.** `onboarding-dispatch` (the start date, the plan's steps with their owners, overdue steps reminded once), Mark Step Done, Complete Onboarding (the company email, the login invited, `candidates.hireIn`) and Withdraw.

**PR 7 · Screens.** Recruitment · Onboarding on the contract (figures, the cases, a case in the wide dialog, Onboarding Settings), the public Upload Documents page (#112), the Employee 360 Documents tab.

**PR 8 · Close-out.** Chat cards or reasons for every form, ⌘K, every picture retaken, the guide to Built.

### Fixed from the audit of 12/11/2026

Each fix has a test that fails on `d79e8f23` and passes now (22 tests, run against a clean checkout of that commit).

**Blockers**
1. **Employment type spellings.** `5070_offer_employment_type.sql` swaps the offer's CHECK to the employee's spellings (`full_time`, `part_time`, `contractor`, `consultant`, `intern`) and converts the rows; New Offer maps a vacancy's `contract` and `internship` (`offers.render.employmentFromVacancy`, used by `draft()` and so by the chat card). Contractor and intern vacancies now go through acceptance.
2. **Work email at acceptance** (decided with AJ). The hire is created with their candidate address as the personal email, where every mail to them goes (Upload Documents link, contract), and a placeholder work email of the offer's own, `<offer number>@hire.invalid`, until Complete Onboarding sets the company address. Send Offer refuses a candidate who is an active employee (`CANDIDATE_IS_EMPLOYEE`, "This candidate is already an employee"); archived or left records do not count, so a rehire and a re-offer after Withdraw accept. A refusal inside the acceptance reaches the candidate only as "We could not take your signature. Try again." (`NOT_ACCEPTED`) and is logged for the staff. The new test caught the contract's signer taking the placeholder; it reads the candidate address now.

**Should fix**
3. **Scope all** (decided with AJ): `requireAllScope()` (new in `middleware/rbac.js`) on the Offer Signatory and letter settings, the contract wording, the Checklist and Plans, and Verify, Reject, Record Check, Send Reminder, Resend and Reissue Contract, Complete Onboarding and Withdraw. A Head of Department marks their own hires' steps done. The screens follow `can_check`, `can_complete`, `can_withdraw`, `can_reissue` and the summaries' `can_configure`.
4. **The chat card's range reason**: `OfferCard.range_reason`; outside the range without one, the card is refused on that field, as the form is. No stock text.
5. **Reissue Contract**: `POST /recruitment/contracts/:id/reissue` makes a new contract for a case whose contract the hire declined or let lapse, while the case is at documentation. The hire has 15 days to sign from each link (Sign for Company, Resend), so a contract left unsigned lapses and its `endedIn` runs.
6. **Reopen past Offer** (decided with AJ: fixed here, nothing goes to GE): `candidates.reopen` refuses an application not progressed at Documentation, Pre-Onboarding or Onboarding ("A hire past Offer cannot be reopened"); the sheet hides Reopen there and the mock agrees.
7. **MyCity's Guarantor Form**: `5100_onboarding_guarantor_form.sql` adds date of birth, contact and residential addresses (each picked with `AddressField`, owners `onboarding_guarantor.contact_address` and `.residential_address`, through new `/onboard/:token/places/search` and `/pin`), the conviction and recommendation answers, and an ID copy. A guarantor passes only with the signed form and the ID copy (`FORM_REQUIRED`). The hire's own home address (promised in the handoff, not built) is built: Your Address on the upload page, kept as the employee's home address, and a gate condition (`address`).
8. **Screens**: Employee 360 Documents on `ListDetail` (beside the list on desktop, a sheet on a phone); Upload Document's What Is It and the upload page's item Value on `useContractForm`; the plan editor's steps keyed for their life and the SOP's label looked up by id; View File hands back its download (F26). New tests: `OnboardingSettings.test.tsx`, `EmployeeDocuments.test.tsx`, and the upload page's address, guarantor form and Change BVN.

**Minor**
9. The contract keeps the hire's name it was made with (`employment_contract.hire_name`, 5080) in what its signatures cover.
10. The confirmation date by `lagos.addMonths`.
11. With its approval, Withdraw shows only to its submitter or the CEO.
12. Every write that holds an offer or a contract holds its signature request first (`signatures.holdRequestIn`), as the signing page does.
13. The three long server messages cut to eight words or fewer.
14. An offer approved while the signatory had no login: the Offer Signatory named later sees Sign for Company and opens the request by signing.
15. The contract row through `repo.insert`.
16. Withdraw honours `withdrawnIn`'s answer: an application still active that cannot be withdrawn keeps the case open (`NOT_WITHDRAWN`).
17. The BVN audit test reads the ledger's rows for the BVN's writes (it now fails if there are none, or if one holds the number), and the event log too.
18. Docs: the guide's application stages, §2's Request Document, the handoff header (#122) and the hire address step (built), decisions 10 and 11 marked amended, the contract comment on the BVN, PROGRESS's 107 screens, the BVN correctable until documentation completes (decided with AJ) in the guide, the route comment, the contract and the page (Change BVN).
19. A department's plan links only that department's SOPs (`SOP_OTHER_DEPARTMENT`); the default plan any.

**Other owners**
20. **Seed 5399 and A26**: settled with TB outside this PR; nothing changed here.
21. **GE's modules**: per AJ, everything is fixed on this branch and nothing goes to GE. `candidates` gained `withdrawnIn`, `application.withdrawn`, the ninth Candidate Email (`contract-sent`) and the Reopen rule; all recorded in the handoff log and `recruitment.md` §14.
22. **The access log**: `middleware/access-log.js` and the metrics' route label write a public link's token as `:token` (tests in `tests/unit/foundation/observability.test.js`).

### Migrations

`5070_offer_employment_type.sql`, `5080_contract_hire_name.sql`, `5100_onboarding_guarantor_form.sql` (5010 untouched). UP, DOWN, UP round trip, idempotency and schema drift pass.

### Checks

Run in a Linux workspace on Node 20 with PostgreSQL 16, pgvector and Redis: the offers (16) and onboarding (11) integration files, the M5 modules' unit tests, the observability tests; the frontend typecheck, lint and the tests of the changed screens (Onboarding, Onboarding Settings, Offers, Employee 360, Employee Documents, Upload Documents); the gates for lint, migrations (numbers, UP/DOWN/UP, idempotency), schema drift, contract columns, route contracts, AI manifests and awareness, search, addresses, public surface, pagination, provenance, forms, dates, dashes, upload, money, progress, guides, README map, CODEOWNERS and the User Guide (pictures retaken with `guide:shots --stale`). The whole `npm run ci` runs on GitHub Actions.

### Native app feel

- **Phone**: Employee 360 · Documents shows the list alone and opens a tapped document in a bottom sheet; nothing opens unasked. The upload page's new parts (Your Address, the guarantor's addresses, answers and ID copy, Change BVN, Change Address) stack full width with full-width primary buttons. The onboarding case's sheet shows Reissue Contract full width and hides the actions the reader may not take.
- **Desktop**: Employee 360 · Documents puts the document beside the list (`ListDetail`), the first one shown unasked, no centred dialog. Onboarding's wide dialog shows the guarantors' form fields two by two and Reissue Contract on the contract's card; Offers and Onboarding show their settings button only to Operations & People.

User-guide-unchanged: Queries & Sanctions chapter: its steps on a record's Queries and Sanctions tabs read as before; only the Documents tab beside them now opens a document beside the list (people.md, retaken)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01F3PVVmLDN3YbfciLst1mL5
