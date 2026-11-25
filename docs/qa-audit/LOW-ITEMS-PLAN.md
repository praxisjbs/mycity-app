# Clearing the 49 Low items (build plan)

The QA audit response (`MyCity-QA-Audit-Response.xlsx`) left 49 Low items open after #173 fixed every
High and Medium one. This plan clears all 49 in two PRs. Decisions were taken by JBS Praxis on
25/11/2026 (twelve questions, answers below); they are not reopened while the PRs are built.

Each PR is built from `main`, driven to green and merged before the next starts, and ticks its rows
in the tracker (`compile.py` `FIXED_NOW`, PR number and merge date) in the same PR.

## Decisions (JBS Praxis, 25/11/2026)

| Ref | Audit | Decision |
|---|---|---|
| BG-043 | F58a | The minimum age at the start date is Nigeria's legal minimum, researched from the primary text with its instrument, section and the date checked, written in the foundation guide (CLAUDE.md "Research has sources"). Add Employee and Edit Record refuse a younger start. |
| BG-045 | F58c | TIN and pension PIN formats are researched from the issuing bodies' own published formats, each with its source and date checked. A field whose format has no primary source keeps today's rule and the guide says so in plain words. |
| BG-031 | F32b | Send Offer warns "Starts before the offer expires" and suggests a shorter Valid For or a later start; it still sends. |
| BG-018 | F09c | Refuse an account number that is one digit repeated; show approvers a Name Differs pill when the account name does not contain the payee name. No live bank check (a Change Report). |
| BG-021 | F70 | On a phone, every form in a sheet pins its buttons in the sheet's footer (packages/ui, one change); every phone picture retaken. |
| BG-051 | F34b | Praxis AI answers a how-to question from the User Guide search and the screen list first, offering the full read catalogue only when needed; a test shows fewer tokens on a sample question. The AI job stays Default. No staging measurement is possible from the build session. |
| BG-022, BG-025, BG-023 | F12a, F27, F18 | Home names each figure's denominator ("of 22 expected today") with help terms saying who it counts; Overdue Tasks gets help "Overdue tasks of everyone you can see."; the fixed "Dips are Saturdays" caption is removed. |
| BG-060 | F41 | Record History keeps reminders, each in plain words ("Reminded to send commitments"); no event key ever shows raw. A test covers every key emitted on the employee record. |
| BG-053 | F31 | Staging vacancies: Head Sales & Revenue and Partnerships Associate to Partnership & Growth; Graphics and Motion Designer and Content Producer to Branding & Marketing; Backend Engineer and Customer Support Lead to Technology & Back-office Ops. |
| BG-063 | F75b | A role's People tab lists active logins by default; closed ones sit behind its status filter, so the count and the list agree. |
| BG-033 | F06e | Former staff who still own partnership records appear in the Owner filter with a Left tag. |
| BG-020 | F65b | Serious: a likely duplicate must never go out unnoticed. Detection is tightened (same requester or same payee account, same amount, within the window the guide sets, any state but cancelled or rejected). Send Request is refused with 409 naming the earlier request until the requester confirms; the confirmation is kept on the request and shown to approvers ("Sent despite a possible duplicate"). |

Every other item follows its tracker row's Fix as written.

## PR 1 · People, platform, Self-Service, Home, Settings, Praxis AI (21 items)

| Group | Items | Owner |
|---|---|---|
| Home and Settings | BG-022 Home denominators · BG-023 remove caption · BG-024 approval alert names the record · BG-025 Overdue Tasks help · BG-062 Audit Log names partners and deals · BG-063 role lists active logins · BG-050 policy sheet once per sign-in | TB |
| Shared UI | BG-021 pinned phone footer · BG-048 counts say "unread notices" · BG-030 unread marks asked once per screen | AJ, TB |
| Self-Service and People | BG-015 System Clock-Out help · BG-058 one probation rule · BG-059 cancelled leave approver · BG-060 Record History words · BG-061 days and balance before Send · BG-041 Close Role · BG-042 build account department code · BG-046 Lagos dates in History · BG-047 Praxis AI reads On Probation | AJ, TB |
| Praxis AI and search | BG-051 how-to questions read less · BG-049 search warmed at boot | TB |

## PR 2 · Business modules and the researched rules (28 items)

| Group | Items | Owner |
|---|---|---|
| Expenses and Community | BG-018 payee checks · BG-019 Disbursements tab · BG-020 duplicate refused until confirmed · BG-016 empty audience refused · BG-017 retired departments hidden | AJ, GE |
| Partnerships and Payroll | BG-033 leavers in Owner filter · BG-034 New Partner's signed copy recorded · BG-035 In Approval labels · BG-036 custom money with commas · BG-037 signed value cannot be cleared · BG-038 commission suggested · BG-039 records changed since Compute · BG-040 Record Advance gated | LA |
| Workspace, Offers, Queries | BG-026 staging tasks seed · BG-027 duplicate project name · BG-028 No Login Yet · BG-029 project owner · BG-031 offer start warning · BG-032 verify wording · BG-052 Rule: name | AJ, GE |
| Recruitment and People rules | BG-053 vacancy departments · BG-054 interview after offer warns · BG-055 Reading the CV · BG-056 Apply step title · BG-057 no .doc · BG-043 minimum age · BG-044 minimum wage warning · BG-045 TIN and PIN formats | GE, TB |

## How each PR is finished

`npm run ci` green on Node 20 (all four groups), PROGRESS notes under each module, guides and User
Guide chapters changed with the screens and their pictures retaken (`npm run guide:shots -- --stale`),
the tracker rows ticked and the workbook rebuilt and recalculated with zero formula errors, then
GitHub's CI green and the PR merged.

## Research for PR 2 (checked 25/11/2026 from the primary texts)

- **Minimum age at the start date: 18.** Child's Rights Act 2003, s.28(1)(b): "no child shall be ...
  employed to work in any capacity except where he is employed by a member of his family on light
  work of an agricultural, horticultural or domestic character"; s.277: "'child' means, a person
  under the age of eighteen years" (PLAC copy, https://placng.org/lawsofnigeria/laws/C50.pdf). Lagos
  State's own Child's Right Law, Cap. C7, s.25(1)(b) says the same ("a child must not be ... employed
  to work in any capacity except ... by a member of his family on light work ... approved by the
  Commissioner"), and s.261 defines a child as "a person under the age of eighteen (18) years"
  (https://sabilaw.org/wp-content/uploads/2022/04/Childs-Right-Law-of-Lagos-State-2007-1.pdf).
  The Labour Act, Cap. L1, s.59 could not be read (the online copy refused automated reads); the
  Child's Rights Act s.29 applies its young-person sections to children, and the Act's own s.28 is
  the stricter rule. So Add Employee and Edit Record refuse a start date before the 18th birthday.
- **Tax ID: no format check.** The Nigeria Tax Administration Act 2025 (Official Gazette No. 117,
  26/06/2025; https://gazettengr.com/wp-content/uploads/NIGERIA-TAX-ADMINISTRATION-ACT-2025.pdf),
  ss.4, 7 and 8, requires a Tax ID and says how it is issued and used, but prescribes no format. The
  field keeps today's rule (letters, digits and hyphens, up to 30), and the guide says so in plain words.
- **Pension PIN: "PEN" then digits.** PenCom's Revised Guidelines for Retirement Savings Account
  Registration 2019 (https://www.pencom.gov.ng/wp-content/uploads/2019/06/REVISED-RSA-REGISTRATION-GUIDELINES.pdf)
  show every RSA PIN as "PEN" followed by digits (§5.3.13 and its sample file) and publish no length.
  The field checks the prefix and that only digits follow; no length is enforced.
