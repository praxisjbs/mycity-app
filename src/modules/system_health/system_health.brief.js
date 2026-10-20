"use strict";
/**
 * The brief: the ticked faults as one Markdown file, written so that an AI assistant
 * with the repository can take them from report to a green pull request without being
 * told anything else. The person downloads it and pastes it in. That is the whole point
 * of the file: it carries its own instructions.
 *
 * Two rules it keeps.
 *
 * It asks for **4 to 10 clarity questions before any fix**. MyCity is wide: one fault
 * can touch attendance, payroll and a notice rule at once, and a fix chosen on a guess
 * costs more than the fault. Four is the floor, ten the ceiling, four to a call.
 *
 * It carries **no names**. Route, stack, release, counts and how many people were hit.
 * Never a display name, an email or a user id. Everything in it has been through
 * observability/scrub.js already, and the file is made to leave the building.
 */
const { explain } = require("./system_health.explain");

/** Faults in one brief. More than this is not one fixing session. */
const MAX_FAULTS = 25;

const SEVERITY = { fatal: "Crash", error: "Error", warning: "Warning", notice: "Form refused" };
const ORIGIN = { server: "API", worker: "Worker", job: "Background job", browser: "Browser" };

const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Cut to `max` on a word boundary where there is one. */
function clip(s, max) {
  const text = String(s || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, "")} [...]`;
}

/** A fence long enough that nothing inside can close it. */
function fence(text) {
  const runs = String(text || "").match(/`+/g) || [];
  const ticks = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return `${ticks}\n${String(text).replace(/\s+$/, "")}\n${ticks}`;
}

const when = (v) => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 16) : "unknown");

/**
 * The standing instructions. Everything here is true of this repository whoever reads
 * it, so it does not change with the faults.
 */
function instructions(count) {
  return `## Your job

You are fixing production faults in the **MyCity App ERP** (\`tomblakeasaah196/mycity-app\`): an
Express and PostgreSQL backend with a worker, a staff React app in \`app/\` and a public React app in
\`public-app/\`. Take ${count === 1 ? "this fault" : "these faults"} from report to a green pull request.

1. **Learn the repository before you touch it.** Read \`CLAUDE.md\` first and follow its five steps:
   it decides what you read next and which document wins. Then \`docs/guides/system-health.md\`
   (where these faults come from and what the statuses mean) and the guide for the area each fault
   is in (\`docs/guides/\`). For backend work read \`docs/BACKEND_GUIDE.md\` in full; for a screen,
   \`docs/FRONTEND_GUIDE.md\` and \`docs/FRONTEND_FOUNDATION.md\`; for a schema change,
   \`docs/MIGRATIONS.md\` and \`docs/DATABASE_SCHEMA.md\`. Do not guess how this repository is
   written. It has rules that look arbitrary until you read why.

2. **Rule out what is already done.** Before any root-cause work, sort every fault into
   **Already fixed**, **Not ours** or **To fix**:
   - \`git fetch origin main\`, then \`git log --oneline <last release>..origin/main\`, and
     \`git log -S\` or \`-G\` on the file, function or message. Each fault below gives the release it
     was last seen on; a later commit may already have fixed it.
   - Search the history for \`Fixes-Faults:\` naming its number, and the open pull requests.
   - Read the code as it stands on \`origin/main\` at the frame and route given. Say so if the line
     no longer exists or now guards the case.
   - **Not ours** is a bot, a browser extension, a scan, or load the system is not meant to take.
     Say what shows it.
   Put this as a short table in your first reply, and work only on **To fix**. If nothing is left,
   say so and stop.

3. **Find the root cause.** Several faults are often one bug showing in different places: group
   them. Follow the stack into the code. Reproduce it where you can, ideally as a failing test.
   Say what causes it, the evidence, and how sure you are. Fix causes, not symptoms: catching an
   error and carrying on is not a fix unless the error is genuinely harmless, and then say why.

4. **Ask the owner 4 to 10 questions, then wait.** Use the **AskUserQuestion** tool, as
   \`CLAUDE.md\` requires: 2 to 4 concrete options per question, each with a one-line trade-off,
   your recommendation first with \`(Recommended)\` in its label and why in its description. At most
   4 questions in one call, so 4 to 10 questions is 1 to 3 calls.

   **Four is the minimum, not the target.** This is a wide system: one fault can touch a module's
   service, its contract, a notice rule, a permission and two shells, and the owner's answer
   changes which of those you are allowed to move. Ask the questions whose answers change the fix:
   behaviour a person will notice, a trade-off that is the owner's to make, how far the fix should
   reach, what should happen to records already written wrong. Go past 4 only when the faults are
   separate enough that 4 cannot cover them, and say why you need more. Never ask what the code,
   the git history, the guides or this file already answers. **Change no code until the owner has
   answered.** If AskUserQuestion is not available to you, ask the same questions in chat, in the
   same shape, and still wait.

5. **Fix it.** The smallest change that removes the cause, written like the code around it. The
   rules this repository does not bend, all of them in \`CLAUDE.md\` step 4:
   - every list pages at 25 through \`src/shared/http/paged.js\`; no \`LIMIT\`/\`OFFSET\` in a repo;
   - every request and response shape is a Zod schema in \`packages/contract\`, \`snake_case\`;
     never edit \`contract.gen.ts\`;
   - every write goes through the owning module's service, in a transaction, with \`emit()\`;
     follow-on work is an outbox handler;
   - money through \`shared/money\`, dates ISO on the wire, numbers from \`numbering.allocate()\`,
     files through the vault;
   - components only from \`@mycity/ui\`, styling by token only, nothing the browser styles itself;
   - a migration goes in its milestone's number block with \`-- UP\` and \`-- DOWN\`, idempotent, and
     a merged migration is never edited.
   Add or extend a test that fails without your fix, beside the ones for that area.

6. **Check it before you push.** \`npm run ci\` is the whole suite and it must pass. Re-read your
   own diff as a reviewer would, and ask what in it would turn CI red.

7. **Finish the paperwork.** \`CLAUDE.md\` step 5: update \`docs/PROGRESS.md\` (ticks, Status,
   Updated day-first, the summary counts, a note under the module), make the feature guide match
   what you built with a Change log line, and list any new file in \`README.MD\`. A Stop hook checks
   these and sends you back if they are missing.

8. **Commit, saying what it fixes.** End each fixing commit's message with a line of its own:

   \`Fixes-Faults: #1, #3\`

   using the numbers below. Put the same line in the pull request description, so whoever reads
   Settings · System Health later can tell which commit closed which fault.

9. **Open a draft pull request to \`main\` and drive it green.** Branch \`m<N>/<short-name>\`, where
   N is the milestone of the area you changed (\`docs/PROGRESS.md\` gives it), title in
   Conventional Commits form. In the description give, for each fault: the root cause, the fix, and
   how the owner checks it on the running app (which screen, what to do, what they should now see).
   List what was already fixed or not ours, and why. A frontend change needs the **Native app feel**
   section. Keep going until CI is green. **Do not merge:** merging deploys to staging, and
   production waits for a person. That is the owner's call, not yours.

10. **Report back in a few lines:** the pull request link, what each fault was, what was already
    fixed or not ours, and anything the owner must do. For a fault you judged **Not ours**, say so,
    so somebody can press Ignore on it in Settings · System Health.`;
}

/**
 * One fault as its own section.
 * @param {object} g   a group row, with its counts
 * @param {object[]} occurrences  its latest occurrences
 * @param {number} n   its number in this brief
 */
function faultSection(g, occurrences, n) {
  const out = [];
  out.push("", "---", "");
  out.push(`### #${n} · ${clip(oneLine(g.title), 200)}`);
  out.push("");
  out.push(`- **What:** ${SEVERITY[g.severity] || g.severity} in the ${ORIGIN[g.origin] || g.origin} (\`${g.severity}\`, \`${g.origin}\`). Status: ${g.status}.`);
  if (g.frame) out.push(`- **Where in the code:** \`${oneLine(g.frame)}\``);
  if (g.route) out.push(`- **Route:** \`${g.route}\``);
  out.push(`- **How often:** ${g.today} in the last 24 hours, ${g.total} still on record, hitting ${g.people} different ${g.people === 1 ? "person" : "people"}.`);
  out.push(`- **First seen:** ${when(g.first_seen_at)} (build \`${g.first_release || "unknown"}\`). **Last seen:** ${when(g.last_seen_at)} (build \`${g.last_release || "unknown"}\`).`);
  if (g.regressions > 0) {
    out.push(`- **Came back ${g.regressions} time${g.regressions === 1 ? "" : "s"}** after somebody marked it fixed. Whatever was done before did not hold: say what the earlier fix missed.`);
  }
  out.push(`- **In plain words:** ${explain(g)}`);

  if (g.last_message && oneLine(g.last_message) !== oneLine(g.title)) {
    out.push("", "**Latest message:**", "", fence(clip(g.last_message, 2000)));
  }

  const routes = [...new Set(occurrences.map((o) => o.route).filter(Boolean))];
  if (routes.length > 1) {
    out.push("", `**Routes it happened on:** ${routes.map((r) => `\`${r}\``).join(", ")}`);
  }

  occurrences.forEach((o, i) => {
    out.push("");
    out.push(`**${i === 0 ? "Latest occurrence" : "Earlier"}:** ${when(o.occurred_at)} on \`${o.route || "unknown"}\` (${ORIGIN[o.origin] || o.origin}, build \`${o.release || "unknown"}\`${o.request_id ? `, request \`${o.request_id}\`` : ""})`);
    if (o.message && oneLine(o.message) !== oneLine(g.last_message)) {
      out.push("", fence(clip(o.message, 1000)));
    }
    // The whole stack for the latest; an earlier one only when it differs.
    const first = occurrences[0] && occurrences[0].stack;
    if (o.stack && (i === 0 || o.stack !== first)) {
      out.push("", fence(clip(o.stack, i === 0 ? 4000 : 1500)));
    } else if (!o.stack) {
      out.push("", "_No stack was captured for this occurrence._");
    }
  });

  if (g.notes && g.notes.length) {
    out.push("", "**What the team noted:**");
    for (const note of g.notes) out.push(`- ${oneLine(clip(note.body, 1000))}`);
  }
  return out;
}

/**
 * The whole file.
 * @param {{faults: Array<{group: object, occurrences: object[]}>, downloaded_by?: string|null,
 *          release?: string|null, at?: Date}} input
 * @returns {string}
 */
function build({ faults, downloaded_by: by = null, release = null, at = new Date() }) {
  const list = faults.slice(0, MAX_FAULTS);
  const n = list.length;
  const md = [];

  md.push(`# MyCity faults to fix: ${n} ${n === 1 ? "fault" : "faults"}`);
  md.push("");
  md.push(`Downloaded from MyCity App, Settings · System Health, on ${when(at)} UTC${by ? ` by ${by}` : ""}. Running build: \`${release || "unknown"}\`.`);
  md.push("");
  md.push(`${n === 1 ? "This fault is" : "These faults are"} now marked Being Handled in the app, so nobody fixes ${n === 1 ? "it" : "them"} twice. This file is the whole brief: work through it to the end without waiting to be told more, except for the questions in step 4, where you stop and wait.`);
  md.push("");
  md.push("Nothing here names a person. Counts say how many people a fault hit, never who.");
  md.push("");
  md.push(instructions(n));
  md.push("");
  md.push("## The faults");
  md.push("");
  md.push("| # | Fault | Where | Today | On record | People |");
  md.push("|---|---|---|---|---|---|");
  list.forEach((f, i) => {
    const g = f.group;
    md.push(`| #${i + 1} | ${clip(oneLine(g.title), 90).replace(/\|/g, "\\|")} | ${ORIGIN[g.origin] || g.origin} | ${g.today} | ${g.total} | ${g.people} |`);
  });

  list.forEach((f, i) => md.push(...faultSection(f.group, f.occurrences || [], i + 1)));
  md.push("");
  return md.join("\n");
}

module.exports = { build, instructions, faultSection, fence, clip, MAX_FAULTS };
