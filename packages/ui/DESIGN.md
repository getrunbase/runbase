# Design system (@getrunbase/ui)

Source: `agentic-directions.pen`, variables (`GetVariables()`) and the **DS · Components** board (eillb). The board is the source of truth: when other code differs from it, follow the board.

**Usage rule**: no hard-coded hex or size in components, only classes from `theme.css`. Only shadcn/ui + Tailwind, `lucide-react` icons. Radix is imported only in `components/ui`. No hard-coded text: labels come from the caller (next-intl).

## Installation

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "@getrunbase/ui/theme.css";
@source "../node_modules/@getrunbase/ui";
```

```ts
import { Button } from "@getrunbase/ui/components/ui/button";
import { cn } from "@getrunbase/ui/lib/utils";
```

## Tokens

Names identical to the .pen. Light mode in `:root`, dark mode under `.dark`.

| Group | Variables / classes |
| --- | --- |
| Base | `background` #FFFFFF, `foreground` #2F3037, `card` #FFFFFF, `primary` #2F3037, `primary-foreground` #FFFFFF, `secondary` / `muted` #F7F7F8, `muted-foreground` #787A85, `subtle-foreground` #A3A5AE, `accent` #EEEFF1, `border` #EDEDEF, `input` #E3E3E6, `ring` / `link` #2F6FEB, `destructive` #D44C47 |
| Sidebar | `sidebar` #F7F7F8, `sidebar-foreground` #5F616B, `sidebar-accent` #ECECEF, `sidebar-border` #EDEDEF |
| Tags | `tag-{blue,green,orange,purple,yellow,red}-bg` / `-fg`, `tag-lilac-bg` |
| Canvas | `canvas-bg` #F7F7F8, `canvas-dot` #DCDCE0, `edge` #C4C5CC |
| Surfaces | `surface-accent` #F2F6FF, `surface-strong` #F1F2F5 |
| Shadows | `shadow-sm` (0 1 3 #0000000F), `shadow-card` (0 16 20 #2F303714) |
| Fonts | `font-sans` Inter (`--font-inter`), `font-mono` IBM Plex Mono (`--font-plex-mono`) |
| App type | `text-xs` 12, `text-sm` 13, `text-base` 14, `text-lg` 16, `text-xl` 20, `text-2xl` 28, `text-3xl` 34 |
| Site type | `text-lead` 18, `text-h3` 18, `text-h2` 28, `text-h1` 44, `text-display` 72 |
| Spacing | `space-1` 4 … `space-12` 48 = Tailwind scale (`p-1`, `gap-3`…) |
| Radii | `rounded-sm` 4, `rounded-md` 6, `rounded-lg` 10, `rounded-full` 999 |
| Templates | `w-sidebar` 248, `h-topbar` 44, `h-row` 36 |

Line height: `normal` everywhere (Pencil auto), unless the board says otherwise.

Outlines: Pencil strokes are centered and do not change the size. Outlined components use `inset-ring` to keep the exact paddings of the board.

## Primitives (`components/ds`)

- `IconTile`: `tag-*-bg` tile, `lg` 44 radius 10 icon 20 (GWZWT), `sm` 20 radius 5 icon 12 (Flow node tile).
- `Pill`: radius full, padding 3/10, 12 / 600 (fx5LG).
- `Count`: accent, radius full, padding 1/6, 11 / 600 muted (W9KT7).
- `Kpi`: card with 16 padding, label 13, value 28 / 600, delta 12 `tag-green-fg` (zZPNs).
- `EmptyState`: dashed, padding 48, gap 12 (IOotB).
- `PageHeader`: title 28 / 700, description 14 muted (oKAXv).
- `Container` (1120 content width), `Section`, `Eyebrow`, `SectionHeading` (site).

## Adjusted shadcn (`components/ui`)

- `Button` (E0W4df): padding 8/12, gap 6, radius 6, 13 / 500, icon 14; `default` (primary), `secondary`, `ghost`, `destructive`, `link`.
- `Badge` (fJ7rN): radius 4, padding 2/6, 12 / 500; variants `blue` `green` `orange` `purple` `yellow` `red`, `outline` (tag External).
- `Input` (FMBKg) + `Label`, `Tabs` (O3TcD / d0S1Yv), `Table` (NtOgD / ETMvS), `Card`, `Breadcrumb` (MCtne).
