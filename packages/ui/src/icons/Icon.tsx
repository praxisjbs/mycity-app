/**
 * @component Icon
 * @group Foundations
 * @summary One Lucide glyph by its short name, drawn in the current text colour.
 * @use Beside a word on a button, a nav item, a KPI card or a status line; alone only for well known actions inside an IconButton.
 * @avoid Emoji, another icon set or an inline SVG; an icon alone with no IconButton or label around it.
 * @phone The same glyph; the bottom bar and the More tiles show it at 20 or 24 px.
 * @a11y Decorative (aria-hidden) unless given a label, which makes it role="img" with that name.
 * @status stable
 * @example <Icon name="clock" />
 * @example <Icon name="alert" size="m" label="Late" />
 */
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  Book,
  Briefcase,
  CalendarCheck,
  ChartLine,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  Clock,
  Download,
  EllipsisVertical,
  EyeOff,
  FileText,
  Flag,
  Globe,
  House,
  Image,
  Info,
  LayoutGrid,
  Link,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Mic,
  Moon,
  PanelLeft,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rows3,
  Search,
  Send,
  Settings,
  Share,
  Shield,
  Sparkles,
  SquarePlus,
  Sun,
  Target,
  ThumbsUp,
  User,
  Users,
  Wallet,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "../lib/cn";

/**
 * The short names the screens use, each on the closest Lucide glyph. A new name
 * is added here (and only here) when a screen needs a glyph the set lacks.
 */
export const ICONS = {
  pin: MapPin,
  grid: LayoutGrid,
  clock: Clock,
  user: User,
  users: Users,
  check: CalendarCheck,
  brief: Briefcase,
  link: Link,
  wallet: Wallet,
  msg: MessageCircle,
  spark: Sparkles,
  cog: Settings,
  srch: Search,
  bell: Bell,
  sun: Sun,
  moon: Moon,
  menu: Menu,
  ok: Check,
  alert: CircleAlert,
  plus: Plus,
  up: ChevronUp,
  right: ChevronRight,
  doc: FileText,
  send: Send,
  mail: Mail,
  chart: ChartLine,
  book: Book,
  shield: Shield,
  flag: Flag,
  globe: Globe,
  target: Target,
  x: X,
  left: ChevronLeft,
  dots: EllipsisVertical,
  lock: Lock,
  info: Info,
  thumb: ThumbsUp,
  clip: Paperclip,
  mic: Mic,
  play: Play,
  tick: Check,
  ticks: CheckCheck,
  pause: Pause,
  image: Image,
  home: House,
  download: Download,
  offline: WifiOff,
  refresh: RefreshCw,
  hide: EyeOff,
  help: CircleHelp,
  logout: LogOut,
  rows: Rows3,
  share: Share,
  addbox: SquarePlus,
  panel: PanelLeft,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** Every icon name, in the order above (the gallery shows them all). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const SIZE = {
  s: { box: "size-4", stroke: 1.75 },
  m: { box: "size-5", stroke: 1.6 },
  l: { box: "size-6", stroke: 1.5 },
} as const;

export interface IconProps {
  /** The glyph, by its short name. */
  name: IconName;
  /** `s` 16 px inline (the default), `m` 20 px navigation, `l` 24 px bottom bar and tiles. */
  size?: keyof typeof SIZE;
  /** Extra classes: a token text colour, or a size class to override the box. */
  className?: string;
  /** Gives the icon a name for assistive technology; without it the icon is decorative. */
  label?: string;
}

export function Icon({ name, size = "s", className, label }: IconProps) {
  const Glyph = ICONS[name];
  const s = SIZE[size];
  return (
    <Glyph
      className={cn("flex-none", s.box, className)}
      strokeWidth={s.stroke}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    />
  );
}
