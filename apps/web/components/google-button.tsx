"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Button } from "@getrunbase/ui/components/ui/button";
import { signInWithGoogle } from "@/lib/auth-client";

// "Continue with Google" with an "or" separator, under the auth form.
// `error` is a translated message from a failed Google sign-in (redirect).
export function GoogleButton({ error }: { error?: string }) {
  const t = useTranslations("auth.login");
  const [message, setMessage] = useState(error);
  const [pending, setPending] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full p-3"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const err = await signInWithGoogle(t);
          if (err) {
            setMessage(err);
            setPending(false);
          }
        }}
      >
        <Image src="/google-logo.svg" alt="" width={16} height={16} />
        {t("google")}
      </Button>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
