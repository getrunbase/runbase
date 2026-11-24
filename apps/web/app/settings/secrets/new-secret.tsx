"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
import { setSecret } from "./actions";

// Add / replace a secret in a dialog.
export function NewSecret() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("settings.secrets");
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        <form
          action={async (f) => {
            await setSecret(f);
            setOpen(false);
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
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="secret-value">{t("value")}</Label>
            <Input id="secret-value" name="value" type="password" required />
          </div>
          <DialogFooter>
            <Button type="submit">{tc("save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
