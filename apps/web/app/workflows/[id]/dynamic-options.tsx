"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/error-text";
import { stepOptions } from "../actions";
import { Choice, type StepInput } from "./step-form-fields";

export type Option = { value: string; label: string };

// Choices of a connector input, loaded from the connected account with the
// inputs already filled. Reloaded when those inputs change (`deps`); skipped
// while `enabled` is false (e.g. no file picked yet).
export function useOptions(
  type: string | undefined,
  field: string,
  input: StepInput,
  deps: string[],
  enabled = true,
) {
  const errorText = useErrorText();
  const [state, setState] = useState<{
    key: string;
    options: Option[];
    error?: string;
  }>();
  // Literal values only: variables are resolved at run time, not here.
  const sent: StepInput = {};
  for (const k of ["connection", ...deps]) {
    const v = input[k];
    if (typeof v === "string" && v && !v.includes("{{")) sent[k] = v;
  }
  const key = JSON.stringify([type, field, sent]);
  const on = !!type && enabled;
  useEffect(() => {
    if (!on) return;
    let live = true;
    void stepOptions(type!, field, sent).then((r) => {
      if (!live) return;
      setState({
        key,
        options: r.data ?? [],
        ...(r.error && { error: errorText(r.error) }),
      });
    });
    return () => {
      live = false;
    };
    // `key` covers type, field and the sent inputs.
  }, [key, on]);
  const current = state?.key === key ? state : undefined;
  return {
    options: current?.options ?? [],
    error: current?.error,
    loading: on && !current,
  };
}

// Dropdown of a dynamic input; the stored value stays listed even when the
// account no longer returns it.
export function OptionsSelect({
  type,
  field,
  input,
  deps,
  value,
  onChange,
  enabled,
}: {
  type?: string;
  field: string;
  input: StepInput;
  deps: string[];
  value?: string;
  onChange: (v: string) => void;
  enabled?: boolean;
}) {
  const t = useTranslations("workflows.stepForm");
  const { options, error, loading } = useOptions(
    type,
    field,
    input,
    deps,
    enabled,
  );
  const list =
    value && !options.some((o) => o.value === value)
      ? [{ value, label: value }, ...options]
      : options;
  return (
    <div className="space-y-1">
      <Choice
        value={value}
        options={list}
        onChange={onChange}
        placeholder={
          loading
            ? t("optionsLoading")
            : list.length
              ? t("optionsPlaceholder")
              : t("optionsEmpty")
        }
      />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
