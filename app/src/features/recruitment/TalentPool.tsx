/**
 * Recruitment · Talent Pool (docs/guides/recruitment.md §6.9, §10): strong people kept for a later
 * role, for 24 months from when they were added. Invite to Apply sends one a link for an open role;
 * Remove takes them out at once. Export makes the list a file only the person who asked can open.
 */
import { useEffect, useRef, useState } from "react";
import poolSchemas from "@mycity/contract/schemas/talent_pool.js";
import type { PoolEntry } from "@mycity/contract/contract.gen.ts";
import { invalidate, useApi, useMutation, usePaged } from "@/api/hooks";
import { api } from "@/api/client";
import { saveExport } from "@/api/exports";
import { useAuth } from "@/auth/AuthProvider";
import { KpiTiles } from "@/features/shared/KpiTiles";
import { PagedTable } from "@/features/shared/sections";
import { useSearchParams } from "@/lib/router";
import {
  Button,
  ExportButton,
  Field,
  FilterSelect,
  formatDate,
  FormError,
  FormFooter,
  HelpTerm,
  KeyValue,
  PageHeader,
  Pill,
  SelectField,
  toast,
  Toolbar,
  useConfirm,
  useContractForm,
  useModal,
} from "@mycity/ui";
import { say, sayRefusal, ScoreText, useVacancyOptions } from "./shared";

const KEPT_HELP = "Removed from the pool on this date.";
const INVITED: Array<[string, string]> = [
  ["", "Everyone"],
  ["false", "Not Invited"],
  ["true", "Invited"],
];

export function TalentPool() {
  const modal = useModal();
  const { can } = useAuth();
  const [invited, setInvited] = useState("");
  const summary = useApi("GET /api/v1/recruitment/pool/summary");
  const list = usePaged("GET /api/v1/recruitment/pool", { filters: invited ? { invited: invited as "true" } : {} });
  const open = (p: PoolEntry) =>
    modal.open({ title: p.name, body: (close) => <PoolSheet entry={p} close={close} mayInvite={can("recruitment", "edit")} mayRemove={can("recruitment", "delete")} /> });

  const [params, setParams] = useSearchParams();
  const linked = params.get("id");
  const opened = useRef<string | null>(null);
  // A person found with ⌘K (`?id=`) opens once, read by their id: they may be past the first page.
  useEffect(() => {
    if (!linked) return void (opened.current = null);
    if (opened.current === linked) return;
    opened.current = linked;
    setParams({ id: null }, { replace: true });
    api.call("GET /api/v1/recruitment/pool/:id", { params: { id: linked } }).then(open, say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);

  const s = summary.data;
  const counted = (n: number | null | undefined) => (n === undefined || n === null ? "–" : String(n));
  return (
    <>
      <PageHeader
        title="Talent Pool"
        actions={
          can("recruitment", "export") ? (
            <ExportButton onExport={() => saveExport(api.call("POST /api/v1/recruitment/pool/exports", { body: { ...(invited ? { invited: invited as "true" } : {}), ...(list.q ? { q: list.q } : {}) } }))}>Export</ExportButton>
          ) : undefined
        }
      />
      <KpiTiles
        mobileCols={2}
        items={[
          { label: "In the Pool", value: counted(s?.in_pool) },
          { label: "Invited Back", value: counted(s?.invited_back) },
          { label: "Hired From the Pool", value: counted(s?.hired_from_pool), tone: "ok" },
          { label: "Average Score", value: counted(s?.average_score) },
        ]}
      />
      <Toolbar>
        <FilterSelect label="Invited" value={invited} onChange={setInvited} options={INVITED} />
      </Toolbar>
      <PagedTable<PoolEntry>
        title="Talent Pool"
        list={list}
        search="Search the pool"
        rowKey={(p) => p.talent_pool_entry_id}
        noun="person"
        nounPlural="people"
        onRowClick={open}
        empty={{ title: "Nobody in the Pool" }}
        columns={[
          { key: "who", label: "Candidate", render: (p) => <span className="font-semibold">{p.name}</span> },
          { key: "for", label: "Applied For", render: (p) => p.applied_for?.title ?? "–" },
          { key: "score", label: "Score", render: (p) => <ScoreText score={p.score} provisional={p.score_provisional} /> },
          { key: "added", label: "Added", render: (p) => formatDate(p.created_at), desktop: true },
          { key: "reason", label: "Reason", render: (p) => p.reason, desktop: true },
          { key: "kept", label: <HelpTerm help={KEPT_HELP}>Kept Until</HelpTerm>, render: (p) => formatDate(p.expires_at) },
          { key: "invite", label: "Invited", render: (p) => (p.invited_at ? <Pill tone="info">Invited</Pill> : "–") },
        ]}
      />
    </>
  );
}

function PoolSheet({ entry, close, mayInvite, mayRemove }: { entry: PoolEntry; close: () => void; mayInvite: boolean; mayRemove: boolean }) {
  const modal = useModal();
  const confirm = useConfirm();
  const remove = useMutation("POST /api/v1/recruitment/pool/:id/remove");
  // A form opened from here goes back to the sheet on Cancel (the app holds one dialog at a time).
  const back = () =>
    modal.open({ title: entry.name, body: (done) => <PoolSheet entry={entry} close={done} mayInvite={mayInvite} mayRemove={mayRemove} /> });
  const out = async () => {
    const yes = await confirm({ title: "Remove From Pool", body: `${entry.name} leaves the pool now.`, confirmLabel: "Remove", destructive: true });
    if (!yes) return;
    try {
      await remove.run({ params: { id: entry.talent_pool_entry_id }, body: {} });
      invalidate("/api/v1/recruitment/pool");
      close();
      toast(`${entry.name} removed from the pool`);
    } catch (e) {
      say(e);
    }
  };
  return (
    <>
      <KeyValue
        items={[
          ["Email", entry.email],
          ["Applied For", entry.applied_for?.title ?? "–"],
          ["Score", <ScoreText key="s" score={entry.score} provisional={entry.score_provisional} />],
          ["Reason", entry.reason],
          ["Added", `${formatDate(entry.created_at)}${entry.added_by_name ? `, ${entry.added_by_name}` : ""}`],
          [<HelpTerm key="k" help={KEPT_HELP}>Kept Until</HelpTerm>, formatDate(entry.expires_at)],
          ["Invited", entry.invited_at ? `${formatDate(entry.invited_at)}${entry.invited_vacancy ? `, ${entry.invited_vacancy.title}` : ""}` : "Not yet"],
        ]}
      />
      <FormFooter>
        <Button onClick={close}>Close</Button>
        {mayRemove && <Button variant="danger" onClick={out}>Remove</Button>}
        {mayInvite && <Button variant="primary" onClick={() => modal.open({ title: "Invite to Apply", body: (done) => <InviteForm entry={entry} back={back} close={done} /> })}>Invite to Apply</Button>}
      </FormFooter>
    </>
  );
}

/** Cancel goes back to the person's sheet; only a sent invitation closes it all. */
function InviteForm({ entry, back, close }: { entry: PoolEntry; back: () => void; close: () => void }) {
  const roles = useVacancyOptions("open");
  // The role they applied for is not offered: they cannot be invited to it again.
  const offered = roles.options.filter(([id]) => id !== entry.applied_for?.vacancy_id);
  const f = useContractForm({ vacancy_id: "" }, poolSchemas.PoolInvite);
  const send = useMutation("POST /api/v1/recruitment/pool/:id/invite");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setProblem(null);
    if (!f.check()) return;
    try {
      await send.run({ params: { id: entry.talent_pool_entry_id }, body: f.values });
      invalidate("/api/v1/recruitment/pool");
      close();
      toast(`Invitation sent to ${entry.name}`);
    } catch (e) {
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Field label="Vacancy" {...f.status("vacancy_id")}>
        <SelectField options={offered} placeholder="Pick a role" more={roles.more} onMore={roles.onMore} {...f.field("vacancy_id")} />
      </Field>
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={back}>Cancel</Button>
        <Button variant="primary" onClick={submit}>Send Invitation</Button>
      </FormFooter>
    </>
  );
}

