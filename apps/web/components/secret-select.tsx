"use client";

import { createContext, useContext, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { createSecret } from "@/app/settings/secrets/actions";
import { Badge } from "@getrunbase/ui/components/ui/badge";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useErrorText } from "@/lib/error-text";

// Workspace secret selector: we only handle names,
// the value stays in the vault and is resolved only on the server at run time.

const Ctx = createContext<string[]>([]);
export const SecretsProvider = ({
  names,
  children,
}: {
  names: string[];
  children: React.ReactNode;
}) => <Ctx.Provider value={names}>{children}</Ctx.Provider>;
export const useSecretNames = () => useContext(Ctx);

const NEW = "__new__";

// Manual entry: creates the secret in the vault then returns its name.
export function NewSecretDialog({
  open,
  onOpenChange,
  defaultName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultName?: string;
  onCreated: (name: string) => void;
}) {
  const t = useTranslations("common.secretPicker");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("newTitle")}</DialogTitle>
          <DialogDescription>{t("newDescription")}</DialogDescription>
        </DialogHeader>
        {/* No <form>: the dialog may open inside another form. */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-secret-name">{tc("name")}</Label>
            <Input
              id="new-secret-name"
              defaultValue={defaultName}
              placeholder={"STRIPE_API_KEY"}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-secret-value">{t("value")}</Label>
            <Input id="new-secret-value" type="password" autoComplete="off" />
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={pending}
            onClick={async () => {
              const get = (id: string) =>
                (document.getElementById(id) as HTMLInputElement | null)
                  ?.value ?? "";
              const f = new FormData();
              f.set("name", get("new-secret-name").trim());
              f.set("value", get("new-secret-value"));
              setPending(true);
              const r = await createSecret(f);
              setPending(false);
              if ("error" in r) return setError(errorText(r.error));
              setError(undefined);
              onCreated(r.name);
              onOpenChange(false);
            }}
          >
            {tc("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// One secret (reference by name). `name`: hidden field for forms.
export function SecretSelect({
  value,
  onChange,
  secrets,
  name,
  id,
  disabled,
  placeholder,
  defaultNewName,
}: {
  value?: string;
  onChange?: (name: string) => void;
  secrets?: string[];
  name?: string;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  defaultNewName?: string;
}) {
  const t = useTranslations("common.secretPicker");
  const fromCtx = useSecretNames();
  const [added, setAdded] = useState<string[]>([]);
  const [local, setLocal] = useState(value ?? "");
  const [dialog, setDialog] = useState(false);
  const current = value ?? local;
  const names = [...new Set([...(secrets ?? fromCtx), ...added, current])]
    .filter(Boolean)
    .sort();
  const pick = (v: string) => {
    setLocal(v);
    onChange?.(v);
  };
  const missing =
    !!current && ![...(secrets ?? fromCtx), ...added].includes(current);
  return (
    <>
      {name && <input type="hidden" name={name} value={current} />}
      <Select
        value={current}
        disabled={disabled}
        onValueChange={(v) => (v === NEW ? setDialog(true) : pick(v))}
      >
        <SelectTrigger id={id} className="w-full font-mono">
          <KeyRound className="text-muted-foreground" />
          <SelectValue placeholder={placeholder ?? t("placeholder")} />
        </SelectTrigger>
        <SelectContent>
          {names.map((n) => (
            <SelectItem key={n} value={n} className="font-mono">
              {n}
            </SelectItem>
          ))}
          {names.length > 0 && <SelectSeparator />}
          <SelectItem value={NEW}>
            <Plus /> {t("new")}
          </SelectItem>
        </SelectContent>
      </Select>
      {missing && (
        <p className="text-destructive text-sm">
          {t("missing", { name: current })}
        </p>
      )}
      <NewSecretDialog
        open={dialog}
        onOpenChange={setDialog}
        defaultName={defaultNewName}
        onCreated={(n) => {
          setAdded((a) => [...a, n]);
          pick(n);
        }}
      />
    </>
  );
}

// Several secrets (function permissions): checkable badges.
export function SecretMultiSelect({
  name,
  defaultValue = [],
  secrets,
}: {
  name: string;
  defaultValue?: string[];
  secrets: string[];
}) {
  const t = useTranslations("common.secretPicker");
  const [value, setValue] = useState(defaultValue);
  const [added, setAdded] = useState<string[]>([]);
  const [dialog, setDialog] = useState(false);
  const known = [...secrets, ...added];
  const names = [...new Set([...known, ...value])].sort();
  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name={name} value={value.join(",")} />
      <div className="flex flex-wrap gap-1">
        {names.map((n) => {
          const on = value.includes(n);
          return (
            <Badge
              key={n}
              asChild
              variant={on ? "default" : "outline"}
              className="font-mono"
            >
              <button
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setValue(on ? value.filter((x) => x !== n) : [...value, n])
                }
              >
                {n}
              </button>
            </Badge>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6"
          onClick={() => setDialog(true)}
        >
          <Plus /> {t("new")}
        </Button>
      </div>
      {value.some((n) => !known.includes(n)) && (
        <p className="text-destructive text-sm">
          {t("missing", {
            name: value.filter((n) => !known.includes(n)).join(", "),
          })}
        </p>
      )}
      <NewSecretDialog
        open={dialog}
        onOpenChange={setDialog}
        onCreated={(n) => {
          setAdded((a) => [...a, n]);
          setValue((v) => [...new Set([...v, n])]);
        }}
      />
    </div>
  );
}
