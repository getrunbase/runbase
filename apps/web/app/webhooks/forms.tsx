"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@runbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@runbase/ui/components/ui/input";
import { Label } from "@runbase/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SecretSelect } from "@/components/secret-select";
import { useErrorText } from "@/lib/error-text";
import { createWebhook, testWebhook, type FormState } from "./actions";

const FORMATS = [
  ["stripe", "stripe"],
  ["standard", "standardLong"],
  ["hmac", "hmacLong"],
] as const;

// Creation: name, produced event type, signing secret, format.
export function CreateWebhookDialog({ secrets }: { secrets: string[] }) {
  const t = useTranslations("webhooks.create");
  const tf = useTranslations("webhooks.formats");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("standard");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<FormState, FormData>(
    createWebhook,
    {},
  );
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wh-name">{t("name")}</Label>
            <Input
              id="wh-name"
              name="name"
              placeholder={t("namePlaceholder")}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wh-event">{t("event")}</Label>
            <Input
              id="wh-event"
              name="eventType"
              placeholder={t("eventPlaceholder")}
              required
            />
            <p className="text-muted-foreground text-sm">{t("eventHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wh-format">{t("format")}</Label>
            <input type="hidden" name="format" value={format} />
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger id="wh-format" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {tf(l)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {format === "hmac" && (
            <div className="space-y-2">
              <Label htmlFor="wh-header">{t("header")}</Label>
              <Input id="wh-header" name="header" placeholder={"x-signature"} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="wh-secret">{t("secret")}</Label>
            <SecretSelect
              id="wh-secret"
              name="secretName"
              secrets={secrets}
              defaultNewName="STRIPE_WEBHOOK_SECRET"
            />
            <p className="text-muted-foreground text-sm">{t("secretHint")}</p>
          </div>
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{errorText(state.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Test send: signed JSON payload, stored as a sample.
export function TestWebhookForm({ id }: { id: string }) {
  const t = useTranslations("webhooks.test");
  const errorText = useErrorText();
  const [state, action, pending] = useActionState<FormState, FormData>(
    testWebhook,
    {},
  );
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor={`test-${id}`}>{t("label")}</Label>
      <Textarea
        id={`test-${id}`}
        name="payload"
        rows={3}
        defaultValue={'{ "id": "essai_1" }'}
        className="font-mono text-xs"
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {t("send")}
        </Button>
        {state.ok && (
          <span className="text-muted-foreground text-sm">{t("ok")}</span>
        )}
        {state.error && (
          <span className="text-destructive text-sm">
            {errorText(state.error)}
          </span>
        )}
      </div>
    </form>
  );
}
