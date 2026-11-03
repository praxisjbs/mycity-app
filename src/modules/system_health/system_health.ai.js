"use strict";
/**
 * What the assistant may do on System Health, as cards the person confirms (docs/guides/praxis-ai.md
 * §6.11, decision 33): set the targets and warning levels (only what changes, the rest kept), move a
 * fault's status, and leave a note on a fault, each through the service function the screen's own
 * Save calls, under the `system_health` grant only the Implementation Team and the System
 * Administrator hold. It reads nothing here: a stack trace is engineering detail, and answering a
 * member of staff from one would mislead them; a fault is named by its title alone.
 */
const c = require("@mycity/contract");
const { defineManifest, shapeOf } = require("../../shared/ai/manifest");
const { given, asForm } = require("../../shared/ai/change");
const { oneNamed } = require("../../shared/ai/named");
const routeMap = require("../../shared/route-map");
const service = require("./system_health.service");
const targets = require("./system_health.targets");

const faultsPath = routeMap.screenPath("settings", "faults");

/** "Which fault?" (praxis-ai.md decision 34): the faults still open, as the list titles them. */
const faultChoices = async () => (await service.faults(c.system_health.FaultListQuery.parse({ status: "active" }))).data.map((f) => f.title);
/** A fault named by its words: among the open ones that match them, then the first open page. */
async function faultIdOf(words) {
  for (const q of [words, null]) {
    const page = await service.faults(c.system_health.FaultListQuery.parse({ status: "all", ...(q ? { q } : {}) }));
    const found = oneNamed(page.data, words, (f) => [f.title]);
    if (found) return found.error_group_id;
  }
  return null;
}
const whichFault = { field: "error_group_id", question: "Which fault is it?", options: faultChoices };
const faultRecord = async (values) => {
  if (!values.error_group_id) return [];
  const f = await service.fault(values.error_group_id).catch(() => null);
  return f ? [{ type: "error_group", id: values.error_group_id, label: f.title }] : [];
};

module.exports = defineManifest({
  module: "system_health",
  // System Health's forms, each reached through the card that names what it changes (gate 23, praxis-ai.md decision 33).
  not_offered: {
    PerformanceTargetsUpdate: "via health_targets.edit: the targets' form saves every level together; the card changes what it names (PerformanceTargetsChange)",
    FaultPatch: "via faults.edit: a fault's status is set in its own sheet, which never names it; the card does (FaultChange)",
    FaultNoteCreate: "via faults.note: a note is left in the fault's own sheet, which never names it; the card does (FaultNoteAdd)",
  },
  actions: [
    {
      key: "health_targets.edit",
      label: "Save Targets",
      description: "Change System Health's targets and warning levels: availability, response time, errors, disk, memory, CPU and connections; only what changes",
      input: c.system_health.PerformanceTargetsChange,
      permission: ["system_health", "edit"],
      risk: "standard",
      form: "none: the targets' form saves every level together; the card changes what it names",
      run: async (values, actor) => {
        const saved = await targets.current();
        const body = asForm(c.system_health.PerformanceTargetsUpdate, {
          ...Object.fromEntries(Object.keys(shapeOf(c.system_health.PerformanceTargetsChange)).map((k) => [k, saved[k]])),
          ...given(values),
        });
        return targets.save(body, actor);
      },
      readback: () => [{ type: "performance_target", id: "targets", label: "Targets", status: "saved", link: routeMap.screenPath("settings", "performance") }],
      labels: {
        availability_pct: "Availability (%)",
        response_p95_ms: "Response Time (ms)",
        error_pct: "Errors (%)",
        disk_warn_free_pct: "Disk Warning (% Free)",
        disk_down_free_pct: "Disk Down (% Free)",
        memory_warn_pct: "Memory Warning (%)",
        memory_down_pct: "Memory Down (%)",
        cpu_warn_pct: "CPU Warning (%)",
        cpu_down_pct: "CPU Down (%)",
        connections_warn_pct: "Connections Warning (%)",
        connections_down_pct: "Connections Down (%)",
      },
    },
    {
      key: "faults.edit",
      label: "Save Fault",
      description: "Set a fault's status (open, handling, fixed or ignored), with a note if I like",
      input: c.system_health.FaultChange,
      permission: ["system_health", "edit"],
      risk: "standard",
      form: "none: a fault's status is set in its own sheet, which never names it; the card does",
      // Who holds it is picked on the fault's sheet among the logins that may; the card moves its status.
      fields: ["error_group_id", "status", "note"],
      asks: [whichFault, { field: "status", question: "What is its status now?", choices: ["Open", "Handling", "Fixed", "Ignored"] }],
      resolve: { error_group_id: (value) => faultIdOf(value) },
      records: faultRecord,
      run: (values, actor) => {
        const { error_group_id: id, ...changes } = values;
        return service.patch(id, given(changes), actor);
      },
      readback: (f) => [{ type: "error_group", id: f.error_group_id, label: f.title, status: "saved", link: faultsPath }],
      labels: { error_group_id: "Fault", status: "Status", note: "Note" },
    },
    {
      key: "faults.note",
      label: "Add Note",
      description: "Leave a note on a fault",
      input: c.system_health.FaultNoteAdd,
      permission: ["system_health", "edit"],
      risk: "standard",
      form: "none: a note is left in the fault's own sheet, which never names it; the card does",
      asks: [whichFault, { field: "body", question: "What should the note say?" }],
      resolve: { error_group_id: (value) => faultIdOf(value) },
      records: faultRecord,
      run: async (values, actor) => {
        const note = await service.addNote(values.error_group_id, { body: values.body }, actor);
        return { ...note, error_group_id: values.error_group_id };
      },
      readback: (n) => [{ type: "error_group", id: n.error_group_id, label: "Note added", status: "noted", link: faultsPath }],
      labels: { error_group_id: "Fault", body: "Note" },
    },
  ],
});
