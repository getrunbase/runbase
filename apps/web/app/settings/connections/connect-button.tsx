"use client";

import { useState } from "react";
import { Plug } from "lucide-react";
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
import { connect } from "./actions";

// Connect an account of a provider: optional name, then redirect to the
// provider's consent screen.
export function ConnectButton({ provider }: { provider: string }) {
  const [error, setError] = useState<ActionError | null>(null);
  const errorText = useErrorText();
  const t = useTranslations("settings.connections");
  const tc = useTranslations("common");
  return (
    <Dialog onOpenChange={() => setError(null)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plug /> {t("connect")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("connectTitle", { provider })}</DialogTitle>
          <DialogDescription>{t("connectDescription")}</DialogDescription>
        </DialogHeader>
        <form
          action={async (f) => {
            const r = await connect(f);
            if ("url" in r) window.location.assign(r.url);
            else setError(r.error);
          }}
          className="space-y-4"
        >
          <input type="hidden" name="provider" value={provider} />
          <div className="space-y-2">
            <Label htmlFor="connection-name">{tc("name")}</Label>
            <Input
              id="connection-name"
              name="name"
              placeholder={provider}
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">{t("nameHint")}</p>
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {errorText(error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit">{t("continue", { provider })}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
