/**
 * Sign for the Company (docs/guides/offers.md §3 steps 2 and 5a): the Offer Signatory signs an
 * approved offer, or a hire's employment contract, in the hub, already signed in, so there is no
 * email code. Full name and title, a signature drawn on the pad or typed, and I Agree to Sign
 * Electronically: `POST /offers/:id/sign` or `POST /contracts/:id/sign` with the contract's
 * SignSubmit, the same shape the candidate's signing page sends.
 */
import { useRef, useState } from "react";
import signatureSchemas from "@mycity/contract/schemas/signatures.js";
import type { OfferDetail, SignerView } from "@mycity/contract/contract.gen.ts";
import { ApiError } from "@/api/client";
import { useMutation } from "@/api/hooks";
import { CheckboxField, ChoiceField, Field, FormError, FormFooter, Grid, SignatureField, TextField, toast, useContractForm, Button, type SignatureFieldHandle } from "@mycity/ui";
import { bodySchema, sayRefusal } from "./shared";

const METHODS: Array<["draw" | "type", string]> = [
  ["draw", "Draw"],
  ["type", "Type"],
];

type Values = { full_name: string; title: string; method: "draw" | "type"; typed: string; consent: boolean };

/**
 * A pad's ink is read when Sign is pressed, so the schema checks the other fields against a stand-in
 * image while the pad has ink; an empty pad is marked on the pad itself.
 */
const INKED = "data:image/png;base64,iVBORw0KGgo=";
const bodyOf = (v: Values, png?: string) => ({
  full_name: v.full_name,
  ...(v.title.trim() ? { title: v.title } : {}),
  method: v.method,
  ...(v.method === "draw" ? { signature_png: png ?? INKED } : { typed: v.typed }),
  consent: v.consent as true,
});

export function SignForm({ offer, close, onSaved }: { offer: OfferDetail; close: () => void; onSaved: () => void }) {
  const run = useMutation("POST /api/v1/recruitment/offers/:id/sign");
  return (
    <CompanySignForm
      signers={offer.signers}
      label="Sign Offer"
      close={close}
      submit={async (body) => {
        await run.run({ params: { id: offer.offer_id }, body });
        onSaved();
        toast(`${offer.number} signed for the company`);
      }}
    />
  );
}

type SignBody = ReturnType<typeof bodyOf>;

/** The company's signature on any signed record: the record's own route is `submit`. */
export function CompanySignForm({ signers, label, submit, close }: { signers: SignerView[]; label: string; submit: (body: SignBody) => Promise<void>; close: () => void }) {
  const me = signers.find((s) => s.role === "mycity");
  const f = useContractForm<Values>({ full_name: me?.name ?? "", title: me?.title ?? "", method: "draw", typed: "", consent: false }, bodySchema<Values>(signatureSchemas.SignSubmit, (v) => bodyOf(v)));
  const pad = useRef<SignatureFieldHandle>(null);
  const [empty, setEmpty] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const sign = async () => {
    setProblem(null);
    const png = f.values.method === "draw" ? (pad.current?.toPng() ?? undefined) : undefined;
    const drawn = f.values.method !== "draw" || Boolean(png);
    setEmpty(!drawn);
    if (!f.check() || !drawn) return;
    try {
      await submit(bodyOf(f.values, png));
      close();
    } catch (e) {
      if (e instanceof ApiError && e.fields.signature_png) setEmpty(true);
      sayRefusal(e, f, setProblem);
    }
  };
  return (
    <>
      <Grid cols={2}>
        <Field label="Full Name" {...f.status("full_name")}>
          <TextField {...f.field("full_name")} autoComplete="name" maxLength={120} />
        </Field>
        <Field label="Title" optional {...f.status("title")}>
          <TextField {...f.field("title")} maxLength={120} />
        </Field>
      </Grid>
      <Field label="Signature" {...f.status("method")}>
        <ChoiceField options={METHODS} {...f.field("method")} />
      </Field>
      {f.values.method === "draw" ? (
        <div className="mb-3">
          <SignatureField ref={pad} label="Your Signature" onChange={(ink) => ink && setEmpty(false)} />
          {empty && <FormError>Draw your signature</FormError>}
        </div>
      ) : (
        <Field label="Typed Signature" {...f.status("typed")}>
          <TextField {...f.field("typed")} maxLength={120} />
        </Field>
      )}
      <CheckboxField label="Agree to Sign Electronically" {...f.field("consent")} />
      <FormError>{problem}</FormError>
      <FormFooter>
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" onClick={sign}>{label}</Button>
      </FormFooter>
    </>
  );
}
