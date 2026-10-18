"use strict";
/**
 * A run's file, built as its recipient (docs/guides/home.md §3 step 7, §6 Reports, §7). The
 * outbox handlers in reports.events.js call these in the worker, after the run is committed.
 *
 *   generate(runId, ctx)       home.report_run: check the recipient may still have the report,
 *                              gather it as them and make the file. An XLSX is built and kept
 *                              in the vault here, then emailed. A PDF is queued through
 *                              documents.generate and rendered by the pdf-render job.
 *   fileReady(documentId, ctx) document.generated for a report's PDF: email it.
 *   fileFailed(documentId)     document.render_failed for a report's PDF: the run failed.
 *
 * AS THE RECIPIENT. The report is gathered with the recipient's own grants, scope and masked
 * fields (reports.sources gather), never its owner's or the caller's, so a file never holds a
 * row its recipient could not open on screen. A recipient who is no longer active, may no
 * longer open the report's source, or (for any source but the Overview) no longer holds
 * `home.reports`, gets no file: the run is skipped and nothing is emailed. They are asked
 * before the file is built and again before it is emailed, since a PDF renders in between.
 *
 * ONLY ONCE THE FILE EXISTS is it emailed, through the shared mailer (the email-send queue)
 * with the file attached by its document id; then the run is done.
 *
 * SAFE TO RUN TWICE, as every outbox handler is: a run no longer waiting is left alone; one
 * whose XLSX is already in the vault is only emailed; one whose PDF is being rendered waits for
 * it. The email's job id is the run's, so a retry does not queue it twice.
 *
 * A FAILURE is retried by the outbox, with its back-off. On the outbox row's last attempt the
 * run is marked failed with the reason instead of throwing again, so Recent Runs stops showing
 * it Pending. A PDF the render job gives up on fails the same way.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const grantsCache = require("../../shared/rbac/grants-cache");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const lagos = require("../../shared/time/lagos");
const sources = require("./reports.sources");
const files = require("./reports.files");
const repo = require("./reports.repo");
const service = require("./reports.service");
const { EVENTS, DOC_TYPE, ENTITY } = require("./reports.events");

/** Why a recipient gets no file, as the run records it. */
const SKIPPED = Object.freeze({
  inactive: "The recipient's account is not active.",
  source: "The recipient may no longer open this report's source.",
  capability: "The recipient may no longer receive reports.",
});

/** How the email names the attachment. */
const FORMAT_WORD = Object.freeze({ pdf: "PDF", xlsx: "Excel" });

/** What an error says, short enough for the run's record. */
const reasonOf = (err) => String((err && err.message) || err).slice(0, 500);

/** Whether this outbox attempt is its row's last: a failure now is final. */
const isLast = (ctx) => Boolean(ctx) && ctx.attempt >= ctx.max_attempts;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/**
 * Settle a waiting run and record it. A run already settled is left as it is.
 * @param {object} run  repo.runToGenerate
 * @param {{status: "done"|"failed"|"skipped", error?: string|null, emailed?: boolean}} outcome
 */
function settle(run, outcome) {
  return tx(async (client) => {
    const settled = await repo.settleRun(client, run.home_report_run_id, outcome);
    if (!settled) return;
    await emit(client, {
      key: EVENTS.HOME_REPORT_RUN_FINISHED,
      entity: { type: ENTITY, id: run.home_report_run_id },
      actor: null,
      payload: {
        home_report_run_id: run.home_report_run_id,
        saved_report_id: run.saved_report_id,
        recipient_user_id: run.recipient_user_id,
        format: run.format,
        status: settled.status,
        document_id: settled.document_id,
      },
    });
  });
}

/**
 * Why the run's recipient may not have its file now, or null when they may.
 * @param {object} run  repo.runToGenerate
 */
async function refusal(run) {
  return service.whyNot(pool, await grantsCache.getAuthUser(pool, run.recipient_user_id), run.report_key);
}

/**
 * Email a run's file to its recipient, then settle the run done. The recipient is asked again
 * first, since a PDF is emailed once it has rendered, after it was built: one who may no longer
 * have it is skipped and sent nothing. On the last attempt a mailer that cannot take the file
 * still leaves it: the run is done, not emailed, and says why.
 * @param {object} run  repo.runToGenerate, its document_id set
 * @param {{last: boolean}} opts
 */
async function deliver(run, { last }) {
  const why = await refusal(run);
  if (why) {
    await settle(run, { status: "skipped", error: SKIPPED[why] });
    return;
  }
  const [person] = await repo.people(pool, [run.recipient_user_id]);
  const queues = require("../../jobs/queues");
  try {
    await queues.enqueue(
      "email-send",
      "home-report",
      {
        to: { name: person.display_name, email: person.email },
        recipient: { first_name: person.first_name, last_name: person.last_name, email: person.email },
        template: "scheduled-report",
        data: {
          report_name: run.report_name,
          run_number: run.number,
          format: FORMAT_WORD[run.format],
          scheduled: Boolean(run.report_schedule_id),
        },
        attachments: [{ document_id: run.document_id }],
      },
      { jobId: `home-report-run-${run.home_report_run_id}` },
    );
  } catch (err) {
    if (!last) throw err;
    await settle(run, { status: "done", error: `Not emailed: ${reasonOf(err)}` });
    return;
  }
  await settle(run, { status: "done", emailed: true });
}

/**
 * The run's report gathered as its recipient, made into its file, and the file linked to
 * the run. An XLSX is stored now; a PDF is queued for rendering.
 * @param {object} run  repo.runToGenerate
 * @param {object} person  the recipient, grants-cache getAuthUser
 * @returns {Promise<string|null>} the document id, or null when the run settled meanwhile
 */
async function build(run, person) {
  const at = run.scheduled_for || run.run_at;
  const filters = (run.definition && run.definition.filters) || {};
  const gathered = await sources.gather(pool, person, run.report_key, filters, { at });
  const names = await repo.filterNames(pool, filters);
  const meta = {
    report_name: run.report_name,
    run_number: run.number,
    source: sources.SOURCES[run.report_key].label,
    recipient_name: person.display_name,
    as_at: at,
    filters: sources.describeFilters(run.report_key, filters, {
      departmentName: names.department,
      leaveTypeName: names.leave_type,
    }),
  };
  const entity = { type: ENTITY, id: run.home_report_run_id };

  let buffer = null;
  if (run.format === "xlsx") {
    buffer = await files.workbook(meta, gathered, { org: await documents.orgProfile(pool) });
  }
  return tx(async (client) => {
    const fresh = await repo.runToGenerate(client, run.home_report_run_id, { lock: true });
    if (!fresh || fresh.status !== "pending" || fresh.document_id) return null;
    const doc =
      run.format === "pdf"
        ? await documents.generate(client, {
            doc_type: DOC_TYPE,
            entity,
            data: files.documentVars(meta, gathered),
            actor: null,
            date: lagos.dateOf(at),
          })
        : await vault.store(client, {
            file: {
              buffer,
              originalname: exportFilename({
                base: `${run.number} ${run.report_name}`,
                env: config.APP_ENV,
                extension: "xlsx",
              }),
            },
            purpose: "document",
            doc_type: DOC_TYPE,
            entity,
            source: "generated",
            title: run.report_name,
            actor: null,
          });
    await repo.setRunDocument(client, run.home_report_run_id, doc.document_id);
    return doc.document_id;
  });
}

/**
 * home.report_run: make the run's file as its recipient.
 * @param {string} runId
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function generate(runId, ctx) {
  const run = await repo.runToGenerate(pool, runId);
  if (!run || run.status !== "pending") return;
  if (run.document_id) {
    // Made on an earlier attempt: an XLSX waits only for its email, a PDF for its render.
    if (run.format === "xlsx") await deliver(run, { last: isLast(ctx) });
    return;
  }

  const person = await grantsCache.getAuthUser(pool, run.recipient_user_id);
  const why = await service.whyNot(pool, person, run.report_key);
  if (why) {
    await settle(run, { status: "skipped", error: SKIPPED[why] });
    return;
  }

  let documentId;
  try {
    documentId = await build(run, person);
  } catch (err) {
    if (!isLast(ctx)) throw err;
    await settle(run, { status: "failed", error: reasonOf(err) });
    return;
  }
  if (documentId && run.format === "xlsx") await deliver({ ...run, document_id: documentId }, { last: isLast(ctx) });
}

/**
 * The waiting run a report's PDF belongs to, or null.
 * @param {string} documentId
 */
async function runOf(documentId) {
  const runId = await repo.runOfDocument(pool, documentId);
  const run = runId ? await repo.runToGenerate(pool, runId) : null;
  return run && run.status === "pending" ? run : null;
}

/**
 * document.generated for a report's PDF: the file exists, so it is emailed and the run done.
 * @param {string} documentId
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function fileReady(documentId, ctx) {
  const run = await runOf(documentId);
  if (run) await deliver(run, { last: isLast(ctx) });
}

/**
 * document.render_failed for a report's PDF: the render job gave up, so the run failed.
 * @param {string} documentId
 */
async function fileFailed(documentId) {
  const run = await runOf(documentId);
  if (run) await settle(run, { status: "failed", error: "The PDF could not be rendered." });
}

module.exports = { SKIPPED, generate, fileReady, fileFailed };
