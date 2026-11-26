"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Plug, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { connect } from "@/app/settings/connections/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useErrorText } from "@/lib/error-text";

// Account selector of OAuth nodes: existing connections of the node's
// provider, or a new one connected in a popup without leaving the editor.

export type ConnectionInfo = {
  provider: string;
  name: string;
  account: string | null;
};
type Ctx = {
  connections: ConnectionInfo[];
  // Block type (`node.<id>`) -> provider.
  providers: Record<string, string>;
  // Google Picker public config (null: not configured on this instance).
  googlePicker?: { apiKey: string; appId: string } | null;
};

// Accounts connected from any step are shared with every step of the page.
type Shared = Ctx & { add: (c: ConnectionInfo) => void };
const C = createContext<Shared>({
  connections: [],
  providers: {},
  add: () => {},
});
export function ConnectionsProvider({
  value,
  children,
}: {
  value: Ctx;
  children: React.ReactNode;
}) {
  const [added, setAdded] = useState<ConnectionInfo[]>([]);
  const known = new Set(value.connections.map((c) => c.name));
  const connections = [
    ...value.connections,
    ...added.filter((c) => !known.has(c.name)),
  ];
  return (
    <C.Provider
      value={{
        providers: value.providers,
        googlePicker: value.googlePicker,
        connections,
        add: (c) => setAdded((a) => [...a.filter((x) => x.name !== c.name), c]),
      }}
    >
      {children}
    </C.Provider>
  );
}

export const useGooglePicker = () => useContext(C).googlePicker ?? null;

export const useConnectionProvider = (blockType?: string) => {
  const { providers } = useContext(C);
  return blockType ? providers[blockType] : undefined;
};

const NEW = "__new__";
export const POPUP_MESSAGE = "runbase.connection";

export function ConnectionSelect({
  provider,
  value,
  onChange,
}: {
  provider: string;
  value?: string;
  onChange: (name: string | undefined) => void;
}) {
  const t = useTranslations("common.connectionPicker");
  const errorText = useErrorText();
  const { connections, add } = useContext(C);
  const [error, setError] = useState<string>();
  // Only the select that opened the popup takes its result.
  const [waiting, setWaiting] = useState(false);
  const list = connections.filter((c) => c.provider === provider);

  // Popup result (same origin only).
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== POPUP_MESSAGE)
        return;
      if (!waiting) return;
      setWaiting(false);
      if (e.data.error) return setError(String(e.data.error));
      setError(undefined);
      add({ provider, name: e.data.name, account: e.data.name });
      onChange(e.data.name);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [provider, onChange, add, waiting]);

  const start = async () => {
    // Opened synchronously: popup blockers allow it only in the click.
    const w = window.open(
      "about:blank",
      "runbase-connect",
      "width=520,height=680",
    );
    const f = new FormData();
    f.set("provider", provider);
    f.set("popup", "1");
    setWaiting(true);
    const r = await connect(f);
    if ("error" in r) {
      setWaiting(false);
      w?.close();
      return setError(errorText(r.error));
    }
    if (w) w.location.href = r.url;
    else window.location.assign(r.url);
  };

  // Single account: used by default, no need to pick.
  const current = value ?? (list.length === 1 ? list[0]!.name : "");
  return (
    <div className="space-y-1">
      <Select
        value={current}
        onValueChange={(v) => (v === NEW ? void start() : onChange(v))}
      >
        <SelectTrigger className="w-full">
          <Plug className="text-muted-foreground" />
          <SelectValue placeholder={t("placeholder", { provider })} />
        </SelectTrigger>
        <SelectContent>
          {list.map((c) => (
            <SelectItem key={c.name} value={c.name}>
              {c.name}
              {c.account && c.account !== c.name && (
                <span className="text-muted-foreground"> · {c.account}</span>
              )}
            </SelectItem>
          ))}
          {list.length > 0 && <SelectSeparator />}
          <SelectItem value={NEW}>
            <Plus /> {t("new", { provider })}
          </SelectItem>
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
