import { Button, DocumentFrame, formatDate, RoleCard, SkylineHero, Skeleton, type IconName } from "@mycity/ui";
import { useApi } from "@/api/hooks";
import { Page } from "@/shell/Page";
import { LinkProblem } from "./LinkProblem";

/**
 * Public · Proposal (`/proposal/<token>`, #105, M7): the proposal as MyCity designed it, its owner's
 * contact and Download PDF (docs/guides/partnerships.md §6.10 step 6, §10). The page is the kit's own
 * HTML in a sealed frame, the same the PDF is drawn from; opening it records a view on the server. A
 * declined, expired or withdrawn proposal's link answers as one that no longer works. Never indexed.
 */
export function Proposal({ token }: { token: string }) {
  const p = useApi("GET /api/public/v1/proposals/:token", { params: { token } });
  if (p.error) return <LinkProblem error={p.error} title="Proposal" retry={p.reload} onward={null} />;
  const d = p.data;
  if (!d)
    return (
      <Page title="Proposal">
        <div aria-busy="true" className="public-wrap py-12">
          <Skeleton lines={3} />
          <div className="mt-10">
            <Skeleton lines={8} />
          </div>
        </div>
      </Page>
    );

  const pdf = `/api/public/v1/proposals/${encodeURIComponent(token)}/pdf`;
  const owner = d.owner_contact;
  const first = owner.name.split(/\s+/)[0] || owner.name;
  const facts: Array<{ icon: IconName; text: string }> = [
    { icon: "brief", text: d.partner_name },
    ...(d.valid_until ? [{ icon: "calendar" as const, text: `Valid until ${formatDate(d.valid_until)}` }] : []),
  ];
  const download = (size: "lg" | "md", block = false) => (
    <Button variant="primary" size={size} icon="download" block={block} asChild>
      <a href={pdf} download>
        Download PDF
      </a>
    </Button>
  );
  const contact = [
    { label: "Name", value: owner.name },
    { label: "Title", value: owner.title },
    { label: "Email", value: owner.email ? <a href={`mailto:${owner.email}`}>{owner.email}</a> : null },
    { label: "Phone", value: owner.phone ? <a href={`tel:${owner.phone.replace(/\s+/g, "")}`}>{owner.phone}</a> : null },
  ].filter((x) => x.value != null);

  return (
    <Page
      title={d.title}
      bar={
        <>
          <p>From {owner.name}</p>
          {download("md")}
        </>
      }
    >
      <SkylineHero size="role" record eyebrow={`Prepared for ${d.partner_name}`} title={d.title} facts={facts} note={`From ${owner.name}`}>
        {download("lg")}
        {owner.email && (
          <Button variant="glass" size="lg" icon="mail" asChild>
            <a href={`mailto:${owner.email}`}>Email {first}</a>
          </Button>
        )}
      </SkylineHero>
      <div className="public-wrap flex flex-col gap-10 pt-12 pb-12">
        <DocumentFrame title={d.title} html={d.html} />
        <RoleCard title="Your Contact" items={contact} action={download("lg", true)} className="max-w-130" />
      </div>
    </Page>
  );
}
