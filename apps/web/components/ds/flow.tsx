import type { LucideIcon } from "lucide-react";
import {
  Check,
  CircleCheckBig,
  Ellipsis,
  GitBranch,
  LoaderCircle,
  Lock,
  Mail,
  Maximize,
  Minus,
  Plus,
  Sparkles,
  Unlink,
  X,
  Zap,
} from "lucide-react";
import { cn } from "cn";
import { IconTile } from "./atoms";
import { type Tone, toneBg, toneFg } from "./tone";

// Fj8lH board (Workflow canvas).

export type FlowNodeKind =
  "trigger" | "action" | "ai" | "condition" | "approval";
export type FlowNodeState =
  "default" | "selected" | "unlinked" | "running" | "success" | "failed";

export const flowKind: Record<FlowNodeKind, { tone: Tone; icon: LucideIcon }> =
  {
    trigger: { tone: "green", icon: Zap },
    action: { tone: "blue", icon: Mail },
    ai: { tone: "purple", icon: Sparkles },
    condition: { tone: "orange", icon: GitBranch },
    approval: { tone: "yellow", icon: CircleCheckBig },
  };

const stateOutline: Record<FlowNodeState, string> = {
  default: "outline-border outline-1 -outline-offset-1",
  selected: "outline-ring outline-2 -outline-offset-2",
  unlinked: "outline-unlinked",
  running: "outline-tag-blue-fg outline-1 -outline-offset-1",
  success: "outline-border outline-1 -outline-offset-1",
  failed: "outline-destructive outline-1 -outline-offset-1",
};

// Connection handle: 10px, foreground, 2px white outline.
export function FlowHandle({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-foreground outline-background block size-2.5 rounded-full outline-2 -outline-offset-1",
        className,
      )}
    />
  );
}

// Node run status: p 1/6, gap 4, full radius, 10/500, 10px icon.
export function FlowStatus({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-px text-micro font-medium [&_svg]:size-2.5",
        toneBg[tone],
        toneFg[tone],
      )}
    >
      <Icon />
      {children}
    </span>
  );
}

export const flowStatusIcon = {
  unlinked: { tone: "red", icon: Unlink },
  running: { tone: "blue", icon: LoaderCircle },
  success: { tone: "green", icon: Check },
  failed: { tone: "red", icon: X },
} as const satisfies Record<string, { tone: Tone; icon: LucideIcon }>;

// Canvas node: 240px, p 12/12/0/12, gap 6, radius 10, shadow sm.
// `branches`: output labels (one handle per output, a single one without a label).
export function FlowNode({
  kind,
  kindLabel,
  title,
  description,
  state = "default",
  status,
  branches,
  hasInput = kind !== "trigger",
  icon,
  className,
}: {
  kind: FlowNodeKind;
  kindLabel: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  state?: FlowNodeState;
  status?: React.ReactNode;
  branches?: React.ReactNode[];
  hasInput?: boolean;
  icon?: LucideIcon;
  className?: string;
}) {
  const k = flowKind[kind];
  const s =
    state in flowStatusIcon
      ? flowStatusIcon[state as keyof typeof flowStatusIcon]
      : null;
  const outs = branches?.length ? branches : [null];
  return (
    <div
      data-state={state}
      className={cn(
        "bg-background relative flex w-60 flex-col gap-1.5 rounded-lg px-3 pt-3 shadow-sm",
        stateOutline[state],
        className,
      )}
    >
      {hasInput && (
        <FlowHandle className="absolute -top-1.25 left-1/2 -translate-x-1/2" />
      )}
      <div className="flex items-center gap-2">
        <IconTile icon={icon ?? k.icon} tone={k.tone} size="node" />
        <span className="text-subtle-foreground flex-1 text-tiny font-medium">
          {kindLabel}
        </span>
        {s && status && (
          <FlowStatus tone={s.tone} icon={s.icon}>
            {status}
          </FlowStatus>
        )}
        <Ellipsis className="text-muted-foreground size-3.5" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && (
        <p className="text-muted-foreground leading-node text-xs">
          {description}
        </p>
      )}
      <div className="flex justify-around pt-1.5">
        {outs.map((b, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            {b && (
              <span className="bg-background text-muted-foreground rounded-sm border px-1.5 py-px text-micro font-medium">
                {b}
              </span>
            )}
            <span className="relative h-1.25 w-2.5">
              <FlowHandle className="absolute top-0 left-0" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// "Add a step" button: 22px, round, edge outline.
export function AddStep({
  label,
  className,
  ...props
}: { label: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "bg-background outline-edge text-muted-foreground inline-flex size-5.5 items-center justify-center rounded-full outline-1 -outline-offset-1",
        className,
      )}
      {...props}
    >
      <Plus className="size-3" />
    </button>
  );
}

// Canvas controls: 28px column, radius 6, border separators.
export function CanvasControls({
  labels,
  onZoomIn,
  onZoomOut,
  onFit,
  onLock,
  className,
}: {
  labels: { zoomIn: string; zoomOut: string; fit: string; lock: string };
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit?: () => void;
  onLock?: () => void;
  className?: string;
}) {
  const items = [
    [Plus, labels.zoomIn, onZoomIn],
    [Minus, labels.zoomOut, onZoomOut],
    [Maximize, labels.fit, onFit],
    [Lock, labels.lock, onLock],
  ] as const;
  return (
    <div
      className={cn(
        "bg-background flex w-fit flex-col rounded-md border shadow-sm",
        className,
      )}
    >
      {items.map(([Icon, label, on]) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          onClick={on}
          className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center border-b last:border-b-0"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

// Minimap: 180×120, radius 6, nodes 24×12 accent radius 2.
export function Minimap({
  nodes,
  className,
}: {
  nodes: { x: number; y: number }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-background relative h-30 w-45 overflow-hidden rounded-md border",
        className,
      )}
    >
      {nodes.map((n, i) => (
        <span
          key={i}
          className="bg-accent rounded-2xs absolute h-3 w-6"
          style={{ left: n.x, top: n.y }}
        />
      ))}
    </div>
  );
}
