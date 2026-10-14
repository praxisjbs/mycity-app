<!--
Title: Conventional Commits form, e.g.  feat(attendance): auto clock-out at 17:00
Branch: m<N>/<short-name>
-->

## What this changes

<!-- One or two sentences a teammate can read in ten seconds. -->

## Screens and items

<!-- PROGRESS.md row numbers this moves, e.g. #13 Channels, #15 Announcements; or the M0 item. -->

## Checklist

- [ ] `npm run ci` is green locally, the whole run, not one file
- [ ] `docs/PROGRESS.md`: rows ticked, Status and Updated set, a dated note added under the module
- [ ] Feature guide in `docs/guides/` matches what was built, with a Change log line
- [ ] New files are on the README map (README §11)
- [ ] Every list pages at 25 through `shared/http/paged.js`
- [ ] Contract changed first; `npm run gen:contract` run; `contract.gen.ts` not edited by hand
- [ ] Desktop and mobile both done (frontend changes)
- [ ] Screen text in three tiers: nothing explaining how the system works, help only through help terms or a Details row, word limits met (gate 8, FRONTEND_GUIDE §5)
- [ ] The feature guide's §10 lists what each screen shows open, behind help and on a phone
- [ ] Forms only from `components/form/`, validated as filled (gate 12, FRONTEND_GUIDE §8)

## Native app feel (frontend changes)

<!--
Gate 11 checks every screen at phone and desktop size. Say in a line each what you did; no
screenshots needed. Write "No screen changed" if none did.

Phone: bottom bar, cards instead of tables, sheets, main action at the bottom, what was left off.
Desktop: tables, side panels, keyboard, hover help.
Text: what moved behind a help term or Details row, what was cut as system text.
-->

## Exemptions

<!--
Only if a check does not apply. Keep the line, give a reason; the checks read these:

Progress-unchanged: <reason>
Guide-unchanged: <reason>
-->
