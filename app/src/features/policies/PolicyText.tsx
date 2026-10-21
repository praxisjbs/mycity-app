import type { PolicySection, PolicySignature, RichTextBlock } from "@mycity/contract/contract.gen.ts";
import { Card, CardHeader, formatDate, KeyValue, Pill, RichText } from "@mycity/ui";

/**
 * A policy version as people read it (docs/guides/policies.md §10): a document's text, or a rules
 * policy's sentences by section with what the version changed tagged; who signed it; and what it
 * changed, in lines. Shared by Knowledge Hub · Policies, Policy Updates and the approver's view.
 */

/** The text: a document's blocks, or a rules policy's sections. */
export function PolicyContent({ body, sections, top = 3 }: { body: RichTextBlock[] | null; sections: PolicySection[] | null; top?: 2 | 3 }) {
  if (body) return <RichText blocks={body} top={top} />;
  return (
    <div className="space-y-3">
      {(sections ?? []).map((sec) => (
        <Card key={sec.key}>
          <CardHeader title={sec.title} level={top} right={sec.sentences.some((s) => s.changed) ? <Pill tone="info">Changed</Pill> : undefined} />
          <div data-copy="content" className="space-y-1.5 text-sm leading-normal">
            {sec.sentences.map((s) => (
              <p key={s.key}>{s.text}</p>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Who signed a version: the publisher, then each approver with their stage. */
export function Signatures({ items }: { items: PolicySignature[] }) {
  if (!items.length) return null;
  return (
    <Card className="mt-3">
      <CardHeader title="Signatures" level={3} />
      <KeyValue
        items={items.map((s) => [
          s.role === "publisher" ? "Published" : `Approved${s.stage_name ? `, ${s.stage_name}` : ""}`,
          <span key={s.signed_at} data-copy="content">
            {`${s.signer_name}${s.signer_title ? `, ${s.signer_title}` : ""}, ${formatDate(s.signed_at)}`}
          </span>,
        ])}
      />
    </Card>
  );
}

/** What a version changed, line by line; nothing for a first version. */
export function WhatChanged({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ul data-copy="content" className="list-disc space-y-1 pl-5 text-sm leading-normal">
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}
