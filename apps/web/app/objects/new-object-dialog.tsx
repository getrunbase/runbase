"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
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
import type { Target } from "./schema-editor";

// Schema editor loaded when the dialog opens.
const SchemaEditor = dynamic(
  () => import("./schema-editor").then((m) => m.SchemaEditor),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);

export function NewObjectDialog({
  database,
  targets,
  trigger,
}: {
  database?: string;
  targets: Target[];
  // Custom trigger (the database's "New object" card).
  trigger?: React.ReactNode;
}) {
  const t = useTranslations("objects");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus />
            {t("new")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("new")}</DialogTitle>
        </DialogHeader>
        <SchemaEditor
          database={database}
          targets={targets}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
