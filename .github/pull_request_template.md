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

## Exemptions

<!--
Only if a check does not apply. Keep the line, give a reason; the checks read these:

Progress-unchanged: <reason>
Guide-unchanged: <reason>
-->
