import type { FunctionRow } from "@getrunbase/core/functions";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { Input } from "@getrunbase/ui/components/ui/input";
import { Label } from "@getrunbase/ui/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SecretMultiSelect } from "@/components/secret-select";
import { saveFunction } from "./actions";
import { CodeEditor } from "./code-editor";
import { ActionForm } from "@/components/action-form";

const perms = (f?: FunctionRow) =>
  f?.permissions as { domains: string[]; secrets: string[] } | undefined;

// Function creation / new version form.
export function FunctionForm({
  fn,
  secrets,
  readOnly,
}: {
  // Not an admin: no save button (saving needs the admin scope).
  readOnly?: boolean;
  fn?: FunctionRow;
  // Workspace secret names (never the values).
  secrets: string[];
}) {
  const t = useTranslations("functions.form");
  const tc = useTranslations("common");
  const field = (id: string, label: string, el: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {el}
    </div>
  );
  return (
    <ActionForm action={saveFunction} className="flex flex-col gap-4">
      {fn ? (
        <input type="hidden" name="name" value={fn.name} />
      ) : (
        field("name", t("name"), <Input id="name" name="name" required />)
      )}
      {field(
        "code",
        t("code"),
        <CodeEditor name="code" defaultValue={fn?.code} />,
      )}
      {field(
        "inputSchema",
        t("inputSchema"),
        <Textarea
          id="inputSchema"
          name="inputSchema"
          className="font-mono"
          defaultValue={JSON.stringify(fn?.inputSchema ?? {})}
        />,
      )}
      {field(
        "outputSchema",
        t("outputSchema"),
        <Textarea
          id="outputSchema"
          name="outputSchema"
          className="font-mono"
          defaultValue={JSON.stringify(fn?.outputSchema ?? {})}
        />,
      )}
      {field(
        "domains",
        t("domains"),
        <Input
          id="domains"
          name="domains"
          defaultValue={perms(fn)?.domains.join(", ")}
        />,
      )}
      {field(
        "secrets",
        t("secrets"),
        <SecretMultiSelect
          name="secrets"
          defaultValue={perms(fn)?.secrets}
          secrets={secrets}
        />,
      )}
      {!readOnly && (
        <Button type="submit" className="self-start">
          {fn ? t("saveVersion") : tc("create")}
        </Button>
      )}
    </ActionForm>
  );
}
