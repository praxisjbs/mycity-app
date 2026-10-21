"use strict";
/**
 * Work counts (docs/guides/performance.md §3 step 6): a task linked to a KPI that enters or
 * leaves Done recounts the KPI's actual, after the task's own change has committed. Only KPIs
 * whose progress comes from Tasks are recounted; a manual KPI keeps the figure people enter.
 */
const outbox = require("../../shared/events/outbox");
const { EVENTS: TASK } = require("../tasks/tasks.events");

const recount = (event) => {
  if (!event.payload || !event.payload.employee_target_id) return null;
  return require("./targets.service").recount(event.payload.employee_target_id);
};

outbox.register(TASK.TASK_COMPLETED, "targets.progress_on_done", recount);
outbox.register(TASK.TASK_REOPENED, "targets.progress_on_reopen", recount);
outbox.register(TASK.TASK_CANCELLED, "targets.progress_on_cancel", recount);

module.exports = { recount };
