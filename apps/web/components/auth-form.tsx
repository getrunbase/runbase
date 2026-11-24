"use client";

import { useState } from "react";
import { useForm, type DefaultValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@getrunbase/ui/components/ui/button";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@getrunbase/ui/components/ui/input";

type Field = {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
};

// Browser autofill hints (password managers, WCAG 1.3.5).
export function autoCompleteOf(f: {
  name: string;
  type: string;
  autoComplete?: string;
}) {
  if (f.autoComplete) return f.autoComplete;
  if (f.type === "email") return "email";
  if (f.type === "password")
    return f.name === "password" ? "current-password" : "new-password";
  if (f.name === "name") return "name";
  return undefined;
}

// Generic auth form (dEYmF board): AuthShell + shadcn Form. onSubmit returns an error message or nothing.
export function AuthForm<T extends Record<string, string>>({
  title,
  description,
  schema,
  fields,
  submitLabel,
  onSubmit,
  footer,
}: {
  title: string;
  description?: string;
  schema: z.ZodType<T, T>;
  fields: Field[];
  submitLabel: string;
  onSubmit: (values: T) => Promise<string | void>;
  footer?: React.ReactNode;
}) {
  const form = useForm<T>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, ""]),
    ) as DefaultValues<T>,
  });
  const [message, setMessage] = useState<string>();

  return (
    <AuthShell footer={footer}>
      <AuthHeading title={title} description={description} />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(async (v) =>
            setMessage((await onSubmit(v)) ?? undefined),
          )}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col gap-4">
            {fields.map((f) => (
              <FormField
                key={f.name}
                control={form.control}
                name={f.name as Path<T>}
                render={({ field }) => (
                  <FormItem className="flex flex-col gap-1.5">
                    <FormLabel className="text-sm font-medium text-foreground">
                      {f.label}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type={f.type}
                        autoComplete={autoCompleteOf(f)}
                        placeholder={f.placeholder}
                        {...field}
                        value={String(field.value ?? "")}
                      />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />
            ))}
            {message && (
              <p className="text-sm text-muted-foreground">{message}</p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full p-3"
            disabled={form.formState.isSubmitting}
          >
            {submitLabel}
          </Button>
        </form>
      </Form>
    </AuthShell>
  );
}
