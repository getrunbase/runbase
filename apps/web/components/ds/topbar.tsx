import Link from "next/link";
import { Fragment } from "react";
import { cn } from "cn";

export type Crumb = {
  label: React.ReactNode;
  href?: string;
  icon?: React.ReactNode;
};

// Top bar (N4zA5 board "Topbar"): h 44, p 0/16, gap 8, bottom border.
// Breadcrumb 13/400: muted parents, subtle "/" separator, current in foreground.
export function TopbarBar({
  toggle,
  crumbs,
  actions,
  className,
}: {
  toggle?: React.ReactNode;
  crumbs: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "bg-background flex h-topbar shrink-0 items-center gap-2 border-b px-4",
        className,
      )}
    >
      {toggle}
      <nav className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          const label = (
            <span className="flex min-w-0 items-center gap-1.5">
              {c.icon}
              <span className="truncate">{c.label}</span>
            </span>
          );
          return (
            <Fragment key={i}>
              {i > 0 && <span className="text-subtle-foreground">/</span>}
              {last ? (
                <span aria-current="page" className="text-foreground min-w-0">
                  {label}
                </span>
              ) : c.href ? (
                <Link
                  href={c.href}
                  className="text-muted-foreground hover:text-foreground min-w-0"
                >
                  {label}
                </Link>
              ) : (
                <span className="text-muted-foreground min-w-0">{label}</span>
              )}
            </Fragment>
          );
        })}
      </nav>
      {actions}
    </header>
  );
}
