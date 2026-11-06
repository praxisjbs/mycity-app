import { EmptyState, PageHeader } from "@mycity/ui";

/**
 * Partnerships · Categories (`categories`, M7). What it shows open, behind help
 * and on a phone is its feature guide's §10; build it from @mycity/ui only
 * (docs/COMPONENTS.md), on the API through the contract, lists 25 to a page
 * (FRONTEND_GUIDE §3, §4).
 */
export function Categories() {
  return (
    <>
      <PageHeader title="Categories" />
      <EmptyState title="Nothing Here Yet" text="Records appear here once added." />
    </>
  );
}
