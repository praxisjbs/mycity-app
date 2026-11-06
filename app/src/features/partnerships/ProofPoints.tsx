import type { ProofPoint } from "@mycity/contract/contract.gen.ts";
import { invalidate, useMutation, usePaged } from "@/api/hooks";
import { useState } from "react";
import { Button, Chips, DataView, IconButton, Menu, Pill, toast, useModal, Who } from "@mycity/ui";
import { PROOF_KIND, ProofPointForm } from "./forms/ProofPointForm";
import { refusal, useConfigure } from "./lib";

type Shown = "true" | "false" | "all";

/**
 * Partnerships · Categories · Proof Points (docs/guides/partnerships.md §6.11, §10.1): MyCity's own facts a proposal
 * may cite, a figure (the size of its network), a partner's logo, an endorsement or a past result. MyCity enters
 * them; Claude cites only these and the record. Holders of `partnerships.configure` add, change, retire and restore.
 */
export function ProofPoints() {
  const configure = useConfigure();
  const modal = useModal();
  const [shown, setShown] = useState<Shown>("true");
  const list = usePaged("GET /api/v1/partnerships/proof-points", { filters: shown === "all" ? {} : { active: shown }, sort: "position" });
  const change = useMutation("PATCH /api/v1/partnerships/proof-points/:id");
  const open = (point?: ProofPoint) => modal.open({ title: point ? "Edit Proof Point" : "Add Proof Point", body: (close) => <ProofPointForm point={point} close={close} /> });
  const setActive = async (p: ProofPoint, active: boolean) => {
    try {
      await change.run({ params: { id: p.proof_point_id }, body: { active } });
      invalidate("/api/v1/partnerships/proof-points");
      toast(active ? "Proof point restored" : "Proof point retired");
    } catch (e) {
      toast(refusal(e, "Not saved. Try again."));
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Chips
          label="Status"
          value={shown}
          onChange={(v) => setShown(v as Shown)}
          options={[
            ["true", "In Use"],
            ["false", "Retired"],
            ["all", "All"],
          ]}
        />
        {configure && (
          <Button variant="primary" icon="plus" onClick={() => open()}>
            Add Proof Point
          </Button>
        )}
      </div>
      <DataView
        title="Proof Points"
        list={list}
        search="Label or Figure"
        rowKey={(p) => p.proof_point_id}
        onRowClick={configure ? (p) => open(p) : undefined}
        noun="proof point"
        empty={{ icon: "star", title: "No Proof Points Yet", text: configure ? "Add the facts a proposal may cite." : undefined }}
        columns={[
          { key: "label", label: "Proof Point", sortable: true, render: (p: ProofPoint) => <Who name={p.label} sub={PROOF_KIND[p.kind]} /> },
          { key: "value", label: "Figure", desktop: true, render: (p: ProofPoint) => p.value },
          { key: "detail", label: "Detail", desktop: true, render: (p: ProofPoint) => p.detail },
          { key: "doc", label: "Image", desktop: true, render: (p: ProofPoint) => (p.document ? p.document.file_name : null) },
          { key: "s", label: "Status", render: (p: ProofPoint) => (p.active ? <Pill tone="ok">In Use</Pill> : <Pill>Retired</Pill>) },
          {
            key: "m",
            label: "",
            desktop: true,
            render: (p: ProofPoint) =>
              configure ? (
                <Menu
                  label={`${p.label} actions`}
                  trigger={(t) => <IconButton {...t} icon="dots" label={`More for ${p.label}`} size="sm" />}
                  items={[
                    { label: "Edit", icon: "edit", onSelect: () => open(p) },
                    p.active
                      ? { label: "Retire", icon: "x", danger: true, onSelect: () => setActive(p, false) }
                      : { label: "Restore", icon: "refresh", onSelect: () => setActive(p, true) },
                  ]}
                />
              ) : null,
          },
        ]}
      />
    </>
  );
}
