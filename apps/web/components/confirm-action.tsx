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
import { useTranslations } from "next-intl";
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
  action: (f: FormData) => void | Promise<void>;
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
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} size={size} disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form action={action}>
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
  );
}
