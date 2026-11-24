"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { Button } from "@getrunbase/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@getrunbase/ui/components/ui/input";
import type { SavedView } from "./actions";

// Saved views menu: apply, save the current view
// (filters, sort, columns), delete.
export function ViewMenu({
  views,
  current,
  onApply,
  onSave,
  onDelete,
}: {
  views: SavedView[];
  current?: string;
  onApply: (v?: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const t = useTranslations("objects.views");
  const tc = useTranslations("common");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const submit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setNaming(false);
  };
  return (
    <>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("saveTitle")}</DialogTitle>
            <DialogDescription>{t("saveDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("name")}
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <DialogFooter>
            <Button onClick={submit} disabled={!name.trim()}>
              {tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7">
            <Bookmark className="size-3.5" /> {current ?? t("title")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel>{t("saved")}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onApply(undefined)}>
            {t("all")}
          </DropdownMenuItem>
          {views.map((v) => (
            <DropdownMenuItem
              key={v.name}
              className="justify-between"
              onSelect={() => onApply(v)}
            >
              <span className="truncate">{v.name}</span>
              <Trash2
                role="button"
                aria-label={t("delete", { name: v.name })}
                className="text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (confirm(t("confirmDelete", { name: v.name })))
                    onDelete(v.name);
                }}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setName(current ?? "");
              setNaming(true);
            }}
          >
            <Plus /> {t("saveCurrent")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
