"use client";

import { useActionState } from "react";
import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";

type Result = { error?: ActionError } | void | undefined | null;

// Form bound to a server action `(f: FormData) => { error? }`: the
// returned error (permission, quota, validation) is shown under the form
// instead of the generic error page.
export function ActionForm({
  action,
  className,
  wrapperClassName = "contents",
  children,
}: {
  action: (f: FormData) => Promise<Result>;
  className?: string;
  // Default: no box of its own, the error wraps on its own line in
  // the parent flex layout.
  wrapperClassName?: string;
  children: React.ReactNode;
}) {
  const errorText = useErrorText();
  const [state, formAction] = useActionState(
    async (_: Result, f: FormData) => action(f),
    undefined,
  );
  return (
    <div className={wrapperClassName}>
      <form action={formAction} className={className}>
        {children}
      </form>
      {state?.error && (
        <p role="alert" className="text-destructive basis-full text-sm">
          {errorText(state.error)}
        </p>
      )}
    </div>
  );
}
