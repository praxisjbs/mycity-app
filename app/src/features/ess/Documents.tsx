import { useState } from "react";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import type { MyDocument } from "@/api/types/ess";
import { Button } from "@/components/ui/Button";
import { KV, Pill, StatStrip, TapList } from "@/components/ui/data";
import { Card, CardHeader, DesktopOnly, Grid, MobileOnly, PageHead } from "@/components/ui/layout";
import { useModal } from "@/components/ui/Modal";
import { Paper, PaperFoot, PaperLogo, PaperTitle, Signature } from "@/components/ui/Paper";
import { Pager, Table } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { useMe } from "@/auth/AuthProvider";
import { formatDate } from "@/lib/format";
import { Field, Input, Upload } from "@/components/form";

export function MyDocumentsPage() {
  const list = usePaged("GET /api/v1/ess/documents");
  const modal = useModal();
  const me = useMe();
  const count = (t: string) => list.rows.filter((d) => d.status.text === t).length;
  const upload = (name = "") => modal.open({ title: "Upload a Document", body: (close) => <UploadForm name={name} close={close} /> });
  const contract = (
    <Paper note="Signed documents carry two hashes and a public verification link.">
      <PaperLogo reference="CON-0004" />
      <PaperTitle sub={`Between MyCity App Ltd and ${me.display_name}`}>Contract of Employment</PaperTitle>
      <p>This agreement sets out the terms on which you are employed as {me.job_title}.</p>
      <p><b>Hours.</b> As set in your individual work schedule.</p>
      <p><b>Leave.</b> Twenty working days of paid annual leave in each calendar year.</p>
      <div className="mt-5 flex gap-[30px]">
        <div><Signature>{me.display_name.split(" ").map((n, i) => (i === 0 ? `${n[0]}.` : n)).join(" ")}</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-[10px] text-paper-faint">Employee</div></div>
        <div><Signature>I. Chukwu</Signature><div className="mt-0.5 border-t border-paper-dash pt-1 text-[10px] text-paper-faint">For MyCity App Ltd</div></div>
      </div>
      <PaperFoot><span>Content hash verified</span><span>Artifact hash verified</span><span className="ml-auto">go.mycityapp.io/verify/CON-0004</span></PaperFoot>
    </Paper>
  );
  const open = (d: MyDocument) =>
    d.signed_number
      ? modal.open({ title: d.name, wide: true, body: contract })
      : modal.open({
          title: d.name,
          body: (
            <>
              <Card><CardHeader title={d.name} /><KV items={[["Uploaded", d.uploaded ? formatDate(d.uploaded) : "Not uploaded"], ["Status", <Pill tone={d.status.tone}>{d.status.text}</Pill>], ["Expires", d.expires ? formatDate(d.expires) : "None"]]} /></Card>
              {(d.status.text === "Missing" || d.status.text === "Expiring") && <Button variant="primary" icon="plus" className="mt-3" onClick={() => upload(d.name)}>Upload Now</Button>}
            </>
          ),
        });
  return (
    <>
      <PageHead title="My Documents" sub="Your vault" actions={<Button variant="primary" icon="plus" onClick={() => upload()}>Upload</Button>} />
      <StatStrip items={[{ label: "Documents", value: String(list.page?.total ?? 0) }, { label: "Signed", value: String(count("Signed")), tone: "ok" }, { label: "Verified", value: String(count("Verified")), tone: "ok" }, { label: "Expiring", value: String(count("Expiring")), tone: "warn" }, { label: "Missing", value: String(count("Missing")), tone: "err" }]} />
      <MobileOnly>
        <TapList items={list.rows.map((d) => ({ key: d.document_ref_id, title: d.name, sub: d.uploaded ? `Uploaded ${formatDate(d.uploaded)}` : "Not uploaded", right: <Pill tone={d.status.tone}>{d.status.text}</Pill>, onClick: () => open(d) }))} />
      </MobileOnly>
      <DesktopOnly>
        <Grid cols="1/1.5">
          <Table
            title="Vault"
            right={<span className="text-[11.5px] text-subtle-foreground">Click a row to open it</span>}
            rows={list.rows}
            rowKey={(d) => d.document_ref_id}
            loading={list.loading}
            onRowClick={open}
            columns={[
              { key: "n", label: "Document", render: (d) => d.name },
              { key: "u", label: "Uploaded", render: (d) => (d.uploaded ? formatDate(d.uploaded) : "None") },
              { key: "s", label: "Status", render: (d) => <Pill tone={d.status.tone}>{d.status.text}</Pill> },
              { key: "e", label: "Expires", render: (d) => (d.expires ? formatDate(d.expires) : "None") },
            ]}
            footer={<Pager page={list.page} onPage={list.setPage} noun="document" />}
          />
          {contract}
        </Grid>
      </DesktopOnly>
    </>
  );
}

function UploadForm({ name: initial, close }: { name: string; close: () => void }) {
  const [name, setName] = useState(initial);
  const save = useMutation("POST /api/v1/ess/documents");
  return (
    <>
      <Field label="What Is It" state={name ? "good" : undefined}>
        <Input value={name} onChange={setName} placeholder="NDPA certificate" />
      </Field>
      <Upload
        purpose="employee_document"
        accept=".pdf,image/*"
        multiple={false}
        onUploaded={async ([doc]) => {
          await save.run({ body: { name: name || doc.file_name, document_id: doc.document_id } });
          invalidate("/api/v1/ess/documents");
          toast("Uploaded. People will verify it.");
          close();
        }}
      />
    </>
  );
}
