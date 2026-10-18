export const meta = {
  name: 'home-pr34-review',
  description: 'Adversarial review of a Home PR diff: lenses find, 3 skeptics verify each finding',
  phases: [
    { title: 'Find', detail: 'one reviewer per lens over the diff' },
    { title: 'Verify', detail: '3 independent skeptics per finding' },
  ],
}
const REPO = args.repo
const S = args.scratch
const BASE = `You are reviewing ${args.pr} of the Home build in ${REPO}, branch ${args.branch}. The diff under review is: git -C ${REPO} diff ${args.base}...HEAD (the PR's own changes; the base is ${args.base}). Read-only: do NOT modify any repository file (you may write throwaway files under ${S}/review-tmp/ and run tests and node scripts with export PATH=/opt/node20/bin:$PATH; DB tests only against database ${args.db} with redis db ${args.redis}: RUN_DB_TESTS=1 APP_ENV=test DATABASE_URL=postgres://mycity:mycity@127.0.0.1:5432/${args.db} REDIS_URL=redis://127.0.0.1:6379/${args.redis}). The binding design is ${S}/DECISIONS.md and docs/guides/home.md; code facts in ${S}/briefs/critique.md. The repository's CLAUDE.md applies. Report only REAL defects with a concrete failure scenario (inputs/state → wrong output, crash, security or data exposure, CI gate failure, broken contract with a consumer, a screen rule broken), not style preferences. Cite file and line. Empty list if nothing real.`
const LENSES = args.lenses
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
  scenario: { type: 'string' }, fix: { type: 'string' } }, required: ['title', 'file', 'line', 'severity', 'scenario', 'fix'] } } }, required: ['findings'] }
const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, reason: { type: 'string' }, better_fix: { type: 'string' } }, required: ['refuted', 'reason', 'better_fix'] }
const results = await pipeline(
  LENSES,
  l => agent(`${BASE}\n\n${l.prompt}`, { label: `find:${l.key}`, phase: 'Find', schema: FINDINGS }),
  (found, l) => parallel((found && found.findings || []).map((f, i) => () =>
    parallel([0, 1, 2].map(k => () => agent(`${BASE}\n\nA reviewer (lens ${l.key}) claims this defect. Try to REFUTE it by reading the actual code and running read-only checks. Refute when the scenario cannot happen, is already handled, is intended by DECISIONS.md or home.md, or misreads the code. If real, say so and give the best minimal fix. Default to refuted=true only if you could not confirm it.\n\nClaim: ${JSON.stringify(f)}`, { label: `verify:${l.key}:${i}:${k}`, phase: 'Verify', schema: VERDICT })))
      .then(vs => { const ok = vs.filter(Boolean); const up = ok.filter(v => !v.refuted)
        return { ...f, lens: l.key, upheld: up.length, votes: ok.length, fixes: up.map(v => v.better_fix).filter(Boolean), reasons: ok.map(v => (v.refuted ? 'REFUTED: ' : 'UPHELD: ') + v.reason) } })
  ))
)
const all = results.filter(Boolean).flat().filter(Boolean)
const confirmed = all.filter(f => f.upheld >= 2)
log(`${all.length} findings, ${confirmed.length} confirmed by 2+ of 3, ${all.length - confirmed.length} dropped`)
return { confirmed, dropped: all.filter(f => f.upheld < 2).map(f => ({ title: f.title, file: f.file, lens: f.lens, upheld: f.upheld })) }
