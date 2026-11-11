/**
 * A conversation's Partner context (docs/guides/partnerships.md §6.15, docs/guides/mailbox.md §3,
 * §10): for the mailbox's owner who sees Partnerships. Linked, a line under the conversation's header
 * names the lead or partner (and deal), opening its 360, with Unlink. Not linked, the conversation's
 * menu offers Link to Partner: Partner (the partners and leads the person sees, leads marked) and
 * Deal. Each message is then logged on the record's Activity, where its readers see the excerpt.
 */
import type { ReactNode } from "react";
import interactions from "@mycity/contract/schemas/interactions.js";
import { api, ApiError } from "@/api/client";
import { invalidate, useApi } from "@/api/hooks";
import { hrefFor } from "@/lib/routes";
import { Link } from "@/lib/router";
import { linkProblem, NO_LINK, PartnerLinkFields, useMayConnect, type PartnerLinkValue } from "@/features/workspace/PartnerLink";
import { Button, Form, FormFooter, Icon, toast, useContractForm, useModal, type MenuItem } from "@mycity/ui";

/** Link to Partner: the record and, optionally, its deal. */
function LinkForm({ threadId, close, done }: { threadId: string; close: () => void; done: () => void }) {
  const f = useContractForm<PartnerLinkValue>(NO_LINK, interactions.ThreadPartnerBind);
  const problem = { record: f.status("partner_id").message ?? f.status("lead_id").message, deal: f.status("deal_id").message };
  const save = async () => {
    if (!f.check()) return;
    try {
      const body = { ...(f.values.partner_id && { partner_id: f.values.partner_id }), ...(f.values.lead_id && { lead_id: f.values.lead_id }), ...(f.values.deal_id && { deal_id: f.values.deal_id }) };
      const ctx = await api.call("POST /api/v1/mailbox/threads/:id/partner", { params: { id: threadId }, body });
      toast(`Linked to ${ctx.record?.name ?? "the partner"}`.slice(0, 60));
      done();
      close();
    } catch (e) {
      const p = linkProblem(e);
      if (p) f.setServerErrors({ ...(p.record ? { partner_id: [p.record] } : {}), ...(p.deal ? { deal_id: [p.deal] } : {}) });
      else toast.error(e instanceof ApiError ? e.message : "Not linked. Try again.");
    }
  };
  return (
    <Form onSubmit={save}>
      <PartnerLinkFields
        open
        value={f.values}
        problem={problem.record || problem.deal ? problem : null}
        onChange={(v) => {
          f.set("partner_id", v.partner_id);
          f.set("lead_id", v.lead_id);
          f.set("deal_id", v.deal_id);
        }}
      />
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Link to Partner
        </Button>
      </FormFooter>
    </Form>
  );
}

/**
 * The conversation's Partner context: the line to show under its header (or null) and the menu item to
 * add (or none). Spam is never linked.
 */
export function usePartnerContext(threadId: string, spam: boolean): { line: ReactNode; menu: MenuItem[] } {
  const may = useMayConnect() && !spam;
  const modal = useModal();
  const ctx = useApi("GET /api/v1/mailbox/threads/:id/partner", { params: { id: threadId }, enabled: may });
  if (!may || !ctx.data) return { line: null, menu: [] };
  const changed = () => {
    ctx.reload();
    invalidate("/api/v1/partnerships/interactions");
  };
  const linkPartner = () => modal.open({ title: "Link to Partner", body: (close) => <LinkForm threadId={threadId} close={close} done={changed} /> });
  const record = ctx.data.record;
  if (!record) return { line: null, menu: [{ label: "Link to Partner", icon: "link", onSelect: linkPartner }] };
  const unlink = async () => {
    try {
      await api.call("DELETE /api/v1/mailbox/threads/:id/partner", { params: { id: threadId } });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Not unlinked. Try again.");
      return;
    }
    changed();
    toast("Conversation unlinked");
  };
  const to = hrefFor("partnerships", record.type === "partner" ? "partners" : "leads", { id: record.id });
  const line = (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ctl bg-muted px-3 py-1.5 text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-2 py-1">
        <Icon name="link" />
        <span data-copy="content">
          <Link className="font-semibold text-primary underline" to={to}>{record.name}</Link>
          {record.type === "lead" && " · Lead"}
          {ctx.data.deal && ` · ${ctx.data.deal.title}`}
        </span>
      </span>
      <Button size="sm" onClick={unlink}>Unlink</Button>
    </div>
  );
  return { line, menu: [{ label: "Change Partner", icon: "link", onSelect: linkPartner }] };
}
