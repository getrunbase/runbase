"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@runbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@runbase/ui/components/ui/input";
import { Label } from "@runbase/ui/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useErrorText } from "@/lib/error-text";
import { importTemplate, type ImportTemplateResult } from "./actions";

// Import of a runbase-template.json: file or pasted JSON.
export function ImportTemplateDialog() {
  const t = useTranslations("databases.import");
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [state, action, pending] = useActionState<
    ImportTemplateResult | null,
    FormData
  >(importTemplate, null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("open")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="template-file">{t("file")}</Label>
            <Input
              id="template-file"
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setText(await f.text());
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="template-json">{t("json")}</Label>
            <Textarea
              id="template-json"
              name="template"
              className="max-h-64 font-mono text-xs"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || !text.trim()}>
            {pending ? t("importing") : t("submit")}
          </Button>
          {state?.error && (
            <Alert variant="destructive">
              <AlertTitle>{t("failed")}</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">
                {errorText(state.error)}
              </AlertDescription>
            </Alert>
          )}
          {state?.done && (
            <Alert>
              <AlertTitle>
                {t("done", {
                  name: state.done.name,
                  count: state.done.objects,
                })}
              </AlertTitle>
              {state.done.missingSecrets.length > 0 && (
                <AlertDescription>
                  {t("missingSecrets", {
                    names: state.done.missingSecrets.join(", "),
                  })}
                </AlertDescription>
              )}
            </Alert>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
