import { PageMessage } from "@mycity/ui";
import { Page } from "@/shell/Page";

/**
 * Public · Proposal (`/proposal/<token>`, #105, M7): the proposal as designed, its owner's contact and
 * Download PDF (docs/guides/partnerships.md §2, §6.10, §10). Built in M7 PR 7 on the design kit and the
 * public proposal route, which reads the link's token; until then the site shows Coming Soon.
 */
export function Proposal() {
  return (
    <Page title="Proposal">
      <PageMessage title="Nothing Here Yet">Proposals appear here once sent.</PageMessage>
    </Page>
  );
}
