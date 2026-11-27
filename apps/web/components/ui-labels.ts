// Accessible labels of the shared UI components (components/ui). These
// components are also exposed to customer pages (@ui/*), which must never
// depend on the app's i18n: the defaults are plain English, and Runbase's own
// UI provides translated labels through UiLabelsProvider.
import { createContext, useContext } from "react";

export const defaultUiLabels = {
  close: "Close",
  loading: "Loading…",
  sidebarTitle: "Sidebar",
  sidebarDescription: "Displays the mobile sidebar.",
  sidebarToggle: "Toggle sidebar",
};

export type UiLabels = typeof defaultUiLabels;

export const UiLabelsContext = createContext<UiLabels>(defaultUiLabels);

export function useUiLabels(): UiLabels {
  return useContext(UiLabelsContext);
}
