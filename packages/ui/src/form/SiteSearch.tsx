/**
 * @component SiteSearch
 * @group Forms
 * @summary The public site's search box: `hero`, the white box with its yellow button over the index's skyline; `intro`, the card-coloured box beside an inner page's headline.
 * @use The index's SkylineHero (tone hero, Search Roles, which opens the careers list on what was typed) and the careers list's PageIntro (tone intro, sent to the server as q as it is typed).
 * @avoid The staff app and any list's own toolbar (use SearchInput); an address (use AddressField); filtering rows already on the screen (FRONTEND_GUIDE §4).
 * @phone hero: the button drops under the box at full width and the box squares off; intro: the full width of the page. 16 px text, so the phone does not zoom.
 * @a11y A form with the search role and a visually hidden label naming the box; Enter submits; the button is a real submit button with its own words. The magnifier is decorative. The box takes the focus ring around its whole shape.
 * @status beta
 * @example <SiteSearch tone="hero" label="Search Roles" placeholder="Role or City" value={q} onChange={setQ} onSubmit={() => navigate(`/jobs?q=${q}`)} action="Search Roles" />
 * @example <SiteSearch tone="intro" label="Search Roles" placeholder="Role or City" value={q} onChange={setQ} />
 */
import { useId } from "react";
import { cn } from "../lib/cn";
import { Icon } from "../icons/Icon";
import { Button } from "../actions/Button";
import { Form } from "./Form";

export interface SiteSearchProps {
  /** What is typed. */
  value: string;
  /** Called on each key. */
  onChange: (value: string) => void;
  /** Enter or the button: return the work to hold the button busy until it settles. Left out, Enter does nothing more (the intro's list already follows what is typed). */
  onSubmit?: () => unknown;
  /** Names the box for assistive technology, Title Case (Search Roles). */
  label: string;
  /** A format example of at most 3 words (Role or City). */
  placeholder?: string;
  /** `hero` (the default): white, with the button; `intro`: on the page's card colour, no button. */
  tone?: "hero" | "intro";
  /** hero: the button's words, Verb Noun (Search Roles); the label unless set. */
  action?: string;
  /** Layout classes only (spacing). */
  className?: string;
}

export function SiteSearch({ value, onChange, onSubmit, label, placeholder, tone = "hero", action, className }: SiteSearchProps) {
  const id = useId();
  const hero = tone === "hero";
  return (
    <Form role="search" onSubmit={onSubmit ?? (() => undefined)} className={cn("ps-search", hero ? "ps-search-hero" : "ps-search-intro", className)}>
      <Icon name="srch" size="m" className={hero ? "size-5.5" : undefined} />
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" enterKeyHint="search" />
      {hero && (
        <Button variant="primary" size="lg" type="submit">
          {action ?? label}
        </Button>
      )}
    </Form>
  );
}
