"use client";
// Actions shown in the header, right of the breadcrumb (e.g. history).
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TOPBAR_ACTIONS_ID = "topbar-actions";

export function TopbarActions({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.getElementById(TOPBAR_ACTIONS_ID)), []);
  return el ? createPortal(children, el) : null;
}
