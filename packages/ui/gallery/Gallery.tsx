import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Icon, cn, useDensity, useIsPhone, type Density } from "../src";
import type { GalleryEntry } from "../src/testing/gallery";

/** Every gallery page in the package, found at build time. */
const pages = import.meta.glob<{ default: GalleryEntry }>("../src/**/*.gallery.tsx", { eager: true });

const ENTRIES: GalleryEntry[] = Object.values(pages)
  .map((m) => m.default)
  .sort((a, b) => a.component.localeCompare(b.component));

/** `#/Button` → "Button"; nothing → null. */
function readHash(): string | null {
  const m = /^#\/([A-Za-z0-9]+)$/.exec(window.location.hash);
  return m?.[1] ?? null;
}

function useRoute(): string | null {
  const [name, setName] = useState(readHash);
  useEffect(() => {
    const on = () => setName(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return name;
}

/** One broken state shows its error in its own frame; the rest of the page still renders. */
class StateBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <p role="alert" className="text-sm text-destructive" data-copy="content">
          {this.state.error.message}
        </p>
      );
    }
    return this.props.children;
  }
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {options.map(([v, text]) => (
        <Button key={v} size="sm" variant={v === value ? "primary" : "ghost"} aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </Button>
      ))}
    </div>
  );
}

/** Density applies to every frame; each state is always shown in both themes. */
function Switches() {
  const { density, setDensity } = useDensity();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Choice<Density> label="Density" value={density} onChange={setDensity} options={[["compact", "Compact"], ["comfortable", "Comfortable"]]} />
    </div>
  );
}

const THEMES = [
  ["light", "Light"],
  ["dark", "Dark"],
] as const;

function ComponentList({ current, className }: { current: string | null; className?: string }) {
  return (
    <nav aria-label="Components" data-ui="nav" className={className}>
      <ul className="flex flex-col gap-0.5">
        {ENTRIES.map((e) => (
          <li key={e.component}>
            <a
              href={`#/${e.component}`}
              aria-current={e.component === current ? "page" : undefined}
              className={cn(
                "flex min-h-tap items-center justify-between rounded-ctl px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                e.component === current && "bg-accent font-semibold text-accent-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span data-copy="content">{e.component}</span>
              <span className="text-xs text-subtle-foreground">{Object.keys(e.states).length}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function States({ entry }: { entry: GalleryEntry }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <h2 className="text-2xl font-strong" data-ui="title" data-copy="content">
        {entry.component}
      </h2>
      {Object.entries(entry.states).map(([state, render]) => {
        const id = `state-${entry.component}-${state.replace(/\W+/g, "-")}`;
        return (
          <section key={state} aria-labelledby={id} className="min-w-0 rounded-card border border-border bg-card">
            <h3 id={id} data-ui="title" className="border-b border-border px-4 py-2 text-xs font-semibold text-muted-foreground">
              {state}
            </h3>
            <div className="grid grid-cols-1 desk:grid-cols-2">
              {THEMES.map(([theme, label]) => (
                <div
                  key={theme}
                  data-theme={theme}
                  data-gallery-frame={theme}
                  aria-label={label}
                  role="group"
                  className="min-w-0 overflow-x-auto bg-background p-4 text-foreground first:rounded-bl-card last:rounded-b-card desk:last:rounded-bl-none desk:last:rounded-br-card"
                >
                  <StateBoundary>{render()}</StateBoundary>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function Gallery() {
  const route = useRoute();
  const phone = useIsPhone();
  const entry = useMemo(() => ENTRIES.find((e) => e.component === route) ?? null, [route]);
  const shown = entry ?? (phone ? null : (ENTRIES[0] ?? null));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 desk:px-6">
        <div className="flex items-center gap-2">
          <Icon name="grid" size="m" className="text-secondary dark:text-primary" />
          <h1 className="text-lg font-strong" data-ui="page-title">
            Component Gallery
          </h1>
        </div>
        <Switches />
      </header>

      <div className="flex">
        <aside className="sticky top-16 hidden max-h-screen w-60 flex-none overflow-y-auto border-r border-border p-3 desk:block">
          <ComponentList current={shown?.component ?? null} />
        </aside>
        <main className="min-w-0 flex-1 p-4 desk:p-6">
          {phone && !entry && <ComponentList current={null} />}
          {phone && entry && (
            <a href="#/" className="mb-3 inline-flex min-h-tap items-center gap-1 text-sm text-accent-foreground" data-ui="button">
              <Icon name="left" />
              All Components
            </a>
          )}
          {shown && <States entry={shown} />}
          {!ENTRIES.length && <p className="text-sm text-muted-foreground">No Gallery Pages</p>}
        </main>
      </div>
    </div>
  );
}
