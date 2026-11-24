import { ArrowLeftRight, Sparkle } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { AuthHeading, AuthShell } from "@/components/auth-shell";

// OAuth consent card (gfPqW board).
export function OAuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <AuthShell width="lg">
      <div className="flex w-full items-center justify-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg bg-tag-orange-bg text-tag-orange-fg">
          <Sparkle className="size-5" />
        </span>
        <ArrowLeftRight className="size-4 text-subtle-foreground" />
        <LogoMark className="size-11 text-foreground" />
      </div>
      <AuthHeading center title={title} description={description} />
      {children}
    </AuthShell>
  );
}
