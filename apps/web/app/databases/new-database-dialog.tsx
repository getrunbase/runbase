"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@runbase/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { Target } from "../objects/schema-editor";

// Schema editor loaded when the dialog opens.
const SchemaEditor = dynamic(
  () => import("../objects/schema-editor").then((m) => m.SchemaEditor),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);

// New database: name, first object and its first fields.
export function NewDatabaseDialog({ targets = [] }: { targets?: Target[] }) {
  const t = useTranslations("databases");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>{t("new")}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
        </DialogHeader>
        <SchemaEditor
          newDatabase
          targets={targets}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
