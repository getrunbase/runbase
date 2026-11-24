"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { useErrorText } from "@/lib/error-text";
import { createApiKey, type CreateResult } from "./actions";

const SCOPES = ["read", "write", "admin"] as const;

// Key creation in a dialog: the plaintext key is shown only once.
type Item = { id: string; name: string };

export function CreateKeyDialog({
  workspaces,
  objects,
}: {
  workspaces: Item[];
  objects: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  // Remounting the form on each open resets the state.
  const [n, setN] = useState(0);
  const t = useTranslations("settings.apiKeys");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setN(n + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> {t("new")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        <KeyForm key={n} workspaces={workspaces} objects={objects} />
      </DialogContent>
    </Dialog>
  );
}

function KeyForm({
  workspaces,
  objects,
}: {
  workspaces: Item[];
  objects: { slug: string; name: string }[];
}) {
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<
    CreateResult | null,
    FormData
  >(createApiKey, null);
  const t = useTranslations("settings.apiKeys");
  const tc = useTranslations("common");
  if (state?.key)
    return (
      <div className="space-y-2 text-sm">
        <p>{t("copyWarning")}</p>
        <pre className="bg-muted rounded-md p-3 font-mono break-all whitespace-pre-wrap">
          {state.key}
        </pre>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => navigator.clipboard.writeText(state.key!)}
          >
            {tc("copy")}
          </Button>
        </DialogFooter>
      </div>
    );
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="key-name">{tc("name")}</Label>
        <Input
          id="key-name"
          name="name"
          placeholder={t("namePlaceholder")}
          required
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("scopesLabel")}</legend>
        <div className="flex gap-4">
          {SCOPES.map((s) => (
            <Label key={s} className="font-normal">
              <Checkbox name="scopes" value={s} defaultChecked={s === "read"} />
              {t(`scopes.${s}`)}
            </Label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("workspaces")}</legend>
        <div className="flex flex-wrap gap-4">
          {workspaces.map((w) => (
            <Label key={w.id} className="font-normal">
              <Checkbox name="workspaceIds" value={w.id} defaultChecked />
              {w.name}
            </Label>
          ))}
        </div>
      </fieldset>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="link" className="h-auto px-0">
            {t("restrict")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-2">
          {objects.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t("objects")}</legend>
              <p className="text-muted-foreground text-sm">
                {t("objectsHint")}
              </p>
              <div className="flex flex-wrap gap-4">
                {objects.map((o) => (
                  <Label key={o.slug} className="font-normal">
                    <Checkbox name="objects" value={o.slug} />
                    {o.name}
                  </Label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="space-y-2">
            <Label htmlFor="key-tools">{t("tools")}</Label>
            <Input
              id="key-tools"
              name="tools"
              placeholder={"records.search, records.upsert"}
            />
            <p className="text-muted-foreground text-sm">{t("toolsHint")}</p>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {state?.error && (
        <p className="text-destructive text-sm">{errorText(state.error)}</p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
