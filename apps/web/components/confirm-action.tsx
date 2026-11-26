"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";
import { Button } from "@getrunbase/ui/components/ui/button";

// Irreversible action: asks for confirmation before submitting the form.
export function ConfirmAction({
  action,
  fields,
  label,
  title,
  description,
  confirmLabel = label,
  variant = "destructive",
  size,
  disabled,
}: {
  // Returned error (permission, quota...): shown next to the button.
  action: (
    f: FormData,
  ) => Promise<{ error?: ActionError } | void | undefined | null>;
  fields: Record<string, string>;
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  variant?: "destructive" | "outline" | "ghost";
  size?: "sm" | "default";
  disabled?: boolean;
}) {
  const t = useTranslations("common");
  const errorText = useErrorText();
  const [state, formAction] = useActionState(
    async (_: unknown, f: FormData) => (await action(f)) ?? undefined,
    undefined,
  );
  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant={variant}
            size={size}
            disabled={disabled}
          >
            {label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <form action={formAction}>
            {Object.entries(fields).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <AlertDialogHeader>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel type="button">{t("cancel")}</AlertDialogCancel>
              <AlertDialogAction type="submit" variant="destructive">
                {confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      {state?.error && (
        <p role="alert" className="text-destructive text-sm">
          {errorText(state.error)}
        </p>
      )}
    </>
  );
}
