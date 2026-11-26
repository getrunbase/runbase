"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import type { ActionError } from "@/lib/action-error";
import { useErrorText } from "@/lib/error-text";
import { setSecret } from "./actions";

// Add a secret, or with `name` set a new value for an existing one (values are
// never read back, so editing means replacing).
export function NewSecret({ name }: { name?: string } = {}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const errorText = useErrorText();
  const t = useTranslations("settings.secrets");
  const tc = useTranslations("common");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        {name ? (
          <Button variant="ghost" size="sm">
            <Pencil /> {tc("edit")}
          </Button>
        ) : (
          <Button>
            <Plus /> {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {name ? t("editTitle", { name }) : t("new")}
          </DialogTitle>
          <DialogDescription>
            {name ? t("editDescription") : t("newDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          action={async (f) => {
            const r = await setSecret(f);
            setError(r.error ?? null);
            if (!r.error) setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="secret-name">{tc("name")}</Label>
            <Input
              id="secret-name"
              name="name"
              placeholder={"STRIPE_API_KEY"}
              className="font-mono"
              defaultValue={name}
              readOnly={!!name}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret-value">{t("value")}</Label>
            <Input
              id="secret-value"
              name="value"
              type="password"
              autoFocus={!!name}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {errorText(error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit">{tc("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
