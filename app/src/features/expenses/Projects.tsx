import budgets from "@mycity/contract/schemas/budgets.js";
import type { ExpenseRow, ProjectSpend } from "@mycity/contract/contract.gen.ts";
import { useState } from "react";
import { ApiError } from "@/api/client";
import { useMutation, usePaged } from "@/api/hooks";
import { PagedTable } from "@/features/shared/sections";
import { ActionGroup, Button, Card, CardHeader, EmptyState, Field, FormFooter, HelpTerm, KeyValue, ListDetail, Meter, Money, MoneyField, PageHeader, toast, toMoneyString, useConfirm, useContractForm, useModal } from "@mycity/ui";
import { asTyped, OwnActions, refreshAll, RequestCard, RequestForm, say, stagePill, useFinance } from "./parts";

/**
 * Expenses · Projects (`projects`, M8): each Workspace project's optional budget, what its
 * requests have committed and spent, and what is left (docs/guides/expenses.md §6.6 rule 6, §10).
 * A project opens in the modal with its requests, New Request with the project filled (handoff
 * decision 17) and, for an `expenses.finance` holder, Set Budget. The tab is read with `expenses`
 * view at scope all (guide §2), which only the server knows: a refused read shows the closed state.
 */
export function Projects() {
  const list = usePaged("GET /api/v1/budgets/projects", { sort: "name" });
  const [picked, setPicked] = useState<ProjectSpend | null>(null);
  if (list.error instanceof ApiError && list.error.status === 403) {
    return (
      <>
        <PageHeader title="Projects" />
        <EmptyState title="Not Open to You" text="Company-wide readers track project spend." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="Projects" sub="Each project's budget and spend" />
      <ListDetail
        layout="modal"
        open={picked !== null}
        onClose={() => setPicked(null)}
        title="Project"
        list={
          <PagedTable<ProjectSpend>
            title="Projects"
            list={list}
            search="Search projects"
            rowKey={(p) => p.project_id}
            noun="project"
            onRowClick={setPicked}
            empty={{ title: "No Projects Yet", text: "Projects come from My Workspace." }}
            columns={[
              { key: "n", label: "Project", render: (p) => <span className="font-semibold">{p.name}</span> },
              { key: "b", label: "Budget", align: "n", render: (p) => (p.budget_amount === null ? "Not set" : <Money value={p.budget_amount} />) },
              { key: "c", label: <HelpTerm help="Approved but not yet paid.">Committed</HelpTerm>, align: "n", render: (p) => <Money value={p.committed} />, desktop: true },
              { key: "s", label: "Spent", align: "n", render: (p) => <Money value={p.spent} />, desktop: true },
              { key: "r", label: "Remaining", align: "n", render: (p) => (p.remaining === null ? "Not set" : <Money value={p.remaining} />) },
            ]}
          />
        }
        detail={picked && <ProjectCard p={picked} close={() => setPicked(null)} />}
      />
    </>
  );
}

const kobo = (v: string) => Math.round(Number(v) * 100);

function ProjectCard({ p, close }: { p: ProjectSpend; close: () => void }) {
  const modal = useModal();
  const finance = useFinance();
  const open = (r: ExpenseRow) => modal.open({ title: "Expense Request", wide: true, body: (c) => <RequestCard id={r.expense_request_id} actions={(x) => <OwnActions r={x} close={() => { c(); close(); }} />} /> });
  const requests = usePaged("GET /api/v1/expenses", { filters: { project_id: p.project_id } });
  const used = p.budget_amount && kobo(p.budget_amount) > 0 ? Math.min(100, Math.round(((kobo(p.committed) + kobo(p.spent)) / kobo(p.budget_amount)) * 100)) : null;
  return (
    <Card>
      <CardHeader record title={`${p.number} ${p.name}`} />
      {used !== null && <Meter pct={used} label="Used" />}
      <KeyValue items={[["Budget", p.budget_amount === null ? "Not set" : <Money key="b" value={p.budget_amount} />], ["Committed", <Money key="c" value={p.committed} />], ["Spent", <Money key="s" value={p.spent} />], ["Remaining", p.remaining === null ? "Not set" : <Money key="r" value={p.remaining} />]]} />
      <div className="mt-3">
        <PagedTable<ExpenseRow>
          title="Requests"
          list={requests}
          rowKey={(r) => r.expense_request_id}
          noun="request"
          onRowClick={open}
          empty={{ title: "No Requests Yet", text: "Raise one with New Request." }}
          columns={[
            { key: "n", label: "Reference", render: (r) => r.number },
            { key: "p", label: "Purpose", render: (r) => r.purpose },
            { key: "a", label: "Amount", align: "n", render: (r) => <Money value={r.amount} /> },
            { key: "s", label: "Stage", render: (r) => stagePill(r) },
          ]}
        />
      </div>
      <div className="mt-3">
        <ActionGroup>
          <Button variant="primary" icon="plus" onClick={async () => { close(); modal.open({ title: "New Request", wide: true, body: (c) => <RequestForm close={c} project={p.project_id} /> }); }}>New Request</Button>
          {finance && <Button onClick={async () => { close(); modal.open({ title: "Set Budget", body: (c) => <BudgetForm p={p} close={c} /> }); }}>Set Budget</Button>}
        </ActionGroup>
      </div>
    </Card>
  );
}

function BudgetForm({ p, close }: { p: ProjectSpend; close: () => void }) {
  // The amount as typed ("1,500,000") is read and sent as the contract's two-place string.
  const f = useContractForm({ budget_amount: p.budget_amount ? asTyped(p.budget_amount) : "" }, { safeParse: (v: { budget_amount: string }) => budgets.ProjectBudget.safeParse({ budget_amount: toMoneyString(v.budget_amount) || null }) });
  const save = useMutation("PATCH /api/v1/budgets/projects/:id");
  const confirm = useConfirm();
  const submit = (clear: boolean) => async () => {
    if (!clear && !f.check()) return;
    if (clear && !(await confirm({ title: "Remove Budget", body: `${p.name} will have no budget.`, confirmLabel: "Remove Budget", cancelLabel: "Keep Budget", destructive: true }))) return;
    try {
      await save.run({ params: { id: p.project_id }, body: { budget_amount: clear ? null : toMoneyString(f.values.budget_amount) || null } });
      refreshAll();
      close();
      toast(clear ? "Budget taken away" : "Budget set");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) f.setServerErrors(e.fields);
      else say(e);
    }
  };
  return (
    <>
      <Field label="Budget" {...f.status("budget_amount")}><MoneyField {...f.field("budget_amount")} /></Field>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        {p.budget_amount !== null && <Button onClick={submit(true)}>Remove Budget</Button>}
        <Button variant="primary" onClick={submit(false)}>Set Budget</Button>
      </FormFooter>
    </>
  );
}
