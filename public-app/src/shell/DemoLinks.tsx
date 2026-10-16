import { Menu, Button } from "@mycity/ui";
import { DEMO_LINKS } from "@/api/mock/demo-links";
import { useRouter } from "@/lib/router";

/**
 * Mock mode only (laptops and CI, F12): the sample addresses, so every state
 * can be opened without an email. Page renders it only when VITE_API_MODE is
 * mock, so a release build drops it and the sample list with it.
 */
export function DemoLinks() {
  const { navigate } = useRouter();
  return (
    <div className="mt-3" data-ui-ignore="demo links">
      <Menu
        align="start"
        label="Demo Links"
        trigger={
          <Button size="sm" variant="ghost" icon="link">
            Demo Links
          </Button>
        }
        items={DEMO_LINKS.map(([label, to]) => ({ label, onSelect: () => navigate(to) }))}
      />
    </div>
  );
}
