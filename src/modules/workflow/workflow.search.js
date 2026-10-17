"use strict";
/**
 * ⌘K for approvals:
 *
 *   Approval Flows   a flow by its name, for whoever reads Settings, Approvals; a result
 *                    opens the screen on that flow. Only the active version is found.
 *   Waiting on You   the requests waiting on the reader's decision, the same list as My
 *                    Approvals (whose stage names them, in modules where they approve). It
 *                    answers an empty line too, first of all, so opening ⌘K shows what waits;
 *                    typing finds a request by its flow, the person it is about or who asked.
 *                    A result opens the record it is about. Its grant is `ess` view, which
 *                    every login holds: the list is the reader's own.
 */
const { recordProvider } = require("../../shared/search/provider");
const service = require("./workflow.service");

const flows = recordProvider({
  type: "workflow_definition",
  module: "settings",
  label: "Approval Flows",
  words: ["flow", "approval flow", "approval route"],
  from: "workflow_definition d",
  key: "d.workflow_definition_id",
  columns: ["d.name", "d.key"],
  select: "d.workflow_definition_id AS id, d.key::text AS ref, d.name AS title, 'Version ' || d.version AS sub",
  where: "d.active",
});

const waiting = Object.freeze({
  type: "approval",
  module: "ess",
  label: "Waiting on You",
  words: ["approval", "approvals", "waiting", "to approve"],
  scoped: false,
  columns: [],
  empty: true,
  pinned: true,
  async search(client, { term, page = 1, user }) {
    const result = await service.mine(user, { page, q: term || undefined }, client);
    return {
      page: result.page,
      items: result.data.map((row) => ({
        id: row.workflow_instance_id,
        type: "approval",
        ref: null,
        title: row.subject_name || row.opened_by_name || row.definition_name,
        sub: `${row.definition_name} · ${row.stage_name}`,
        status: row.overdue ? "overdue" : "waiting",
        link: row.link,
      })),
    };
  },
});

module.exports = [flows, waiting];
