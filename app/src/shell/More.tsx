import { Button, IconButton, MoreSheet, useDensity, useTheme } from "@mycity/ui";
import type { NavBadges } from "@/api/types/identity";
import { useAuth, useMe } from "@/auth/AuthProvider";
import { hrefFor, useRouter } from "@/lib/router";
import type { ModuleDef } from "./catalogue";
import { moreGroups } from "./nav";
import { useInstallApp } from "./Notices";
import { usePwa } from "./pwa";

/**
 * The phone's More (F17): the person's row with Theme, Density and Settings,
 * the search bar, the modules they may open as tiles grouped Work, People,
 * Business and System, Install App while the app is not installed, Sign Out.
 */
export function More({ open, onClose, modules, badges, current, onSearch }: { open: boolean; onClose: () => void; modules: ModuleDef[]; badges: NavBadges | undefined; current: string | null; onSearch: () => void }) {
  const me = useMe();
  const { signOut, can } = useAuth();
  const { navigate } = useRouter();
  const { theme, toggle } = useTheme();
  const density = useDensity();
  const { canInstall } = usePwa();
  const installApp = useInstallApp();
  return (
    <MoreSheet
      open={open}
      onClose={onClose}
      person={{ name: me.display_name, subtitle: me.job_title, photo: me.photo_url }}
      personActions={
        <>
          <IconButton icon={theme === "dark" ? "sun" : "moon"} label={theme === "dark" ? "Light Theme" : "Dark Theme"} onClick={toggle} />
          <IconButton icon="rows" label={density.density === "compact" ? "Comfortable Density" : "Compact Density"} onClick={density.toggle} />
          <IconButton
            icon="cog"
            label="Settings"
            onClick={() => {
              onClose();
              navigate(can("settings") ? hrefFor("settings", "appearance") : hrefFor("ess", "my-security"));
            }}
          />
        </>
      }
      onSearch={() => {
        onClose();
        onSearch();
      }}
      groups={moreGroups(modules, badges)}
      current={current}
      onNavigate={navigate}
      extra={
        canInstall ? (
          <Button block icon="download" onClick={installApp}>
            Install App
          </Button>
        ) : undefined
      }
      onSignOut={() => {
        onClose();
        void signOut();
      }}
    />
  );
}
