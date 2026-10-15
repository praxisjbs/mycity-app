import type { ReactNode } from "react";
import { Icon } from "@mycity/ui";

/**
 * A generated document as it will print: white paper in both themes, City Green
 * logo and a yellow rule (MILESTONES §5.3, brand intensity on partner-facing
 * documents). The real file is rendered by the document engine; this is its preview.
 */
export function Paper({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-muted px-4 py-5">
      {note && (
        <div className="mb-[14px] flex items-center justify-center gap-[7px] text-[11.5px] text-subtle-foreground">
          <Icon name="doc" />
          {note}
        </div>
      )}
      <div data-copy="content" className="mx-auto max-w-[620px] rounded-box border border-border bg-paper px-7 py-[26px] text-[12.5px] leading-[1.62] text-paper-ink shadow-2 max-md:px-4 max-md:py-[18px] [&_p]:mt-[9px]">
        {children}
      </div>
    </div>
  );
}

export function PaperLogo({ reference }: { reference: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b-2 border-paper-gold pb-3 text-paper-brand">
      <Icon name="pin" className="size-5" />
      <b className="text-[14px]">MyCity App Ltd</b>
      <em className="ml-auto text-[10.5px] tracking-[.05em] text-paper-faint not-italic">{reference}</em>
    </div>
  );
}

export function PaperTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <h3 className="text-[15px] tracking-[-.01em] text-paper-heading">{children}</h3>
      {sub && <p className="!mt-[3px] text-[11.5px] text-paper-muted">{sub}</p>}
    </>
  );
}

/** A table on paper; the last row of `totals` is ruled in City Green. */
export function PaperTable({ head, rows, totals }: { head: [ReactNode, ReactNode]; rows: Array<[ReactNode, ReactNode]>; totals?: Array<[ReactNode, ReactNode]> }) {
  return (
    <table className="mt-2.5 w-full border-collapse text-[12px]">
      <thead>
        <tr>
          <th className="border-b border-paper-line bg-paper-head px-2.5 py-[7px] text-left text-[9.5px] tracking-[.09em] text-paper-muted uppercase">{head[0]}</th>
          <th className="border-b border-paper-line bg-paper-head px-2.5 py-[7px] text-right text-[9.5px] tracking-[.09em] text-paper-muted uppercase">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([a, b], i) => (
          <tr key={i}>
            <td className="border-b border-paper-rule px-2.5 py-[7px]">{a}</td>
            <td className="border-b border-paper-rule px-2.5 py-[7px] text-right">{b}</td>
          </tr>
        ))}
        {totals?.map(([a, b], i) => (
          <tr key={`t${i}`}>
            <td className="border-t-2 border-paper-brand bg-paper-head px-2.5 py-[7px] font-bold">{a}</td>
            <td className="border-t-2 border-paper-brand bg-paper-head px-2.5 py-[7px] text-right font-bold">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PaperFoot({ children }: { children: ReactNode }) {
  return <div className="mt-[18px] flex flex-wrap items-center gap-2.5 border-t border-dashed border-paper-dash pt-3 text-[10.5px] text-paper-faint">{children}</div>;
}

export const Signature = ({ children }: { children: ReactNode }) => <span className="font-script text-[20px] text-paper-heading">{children}</span>;
