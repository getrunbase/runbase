import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { LogoMark } from "@/components/logo";
import { LocaleSwitch } from "@/components/locale-switch";

const WIDTHS = { sm: "w-100", md: "w-110", lg: "w-115" } as const;

// Pages outside the shell (boards dEYmF, vrcAN, w0pyPu, gfPqW): brand, centred card, footer.
export function AuthShell({
  width = "sm",
  footer,
  children,
}: {
  width?: keyof typeof WIDTHS;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("auth");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary px-4 py-8">
      <div className="flex items-center gap-2">
        <LogoMark className="size-6 text-foreground" />
        <span className="text-lg font-semibold text-foreground">
          {t("brand")}
        </span>
      </div>
      <div
        className={cn(
          "flex max-w-full flex-col gap-6 rounded-lg bg-background p-8 ring-1 ring-border ring-inset",
          WIDTHS[width],
        )}
      >
        {children}
      </div>
      {footer}
      <LocaleSwitch />
    </main>
  );
}

export function AuthHeading({
  title,
  description,
  center,
}: {
  title: string;
  description?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-1", center && "text-center")}>
      <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// "question + link" footer under the card.
export function AuthFooter({
  question,
  label,
  href,
}: {
  question: string;
  label: string;
  href: string;
}) {
  return (
    <p className="flex gap-1 text-sm">
      <span className="text-muted-foreground">{question}</span>
      <Link href={href} className="font-medium text-ring hover:underline">
        {label}
      </Link>
    </p>
  );
}
