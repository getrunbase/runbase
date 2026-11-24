// @getrunbase/kit: data-bound blocks for TSX pages (@getrunbase/sdk
// hooks + host shadcn components `@ui/<name>`).
export { DataTable, Kanban, Calendar, Timeline, Gallery, useFields } from "./views";
export type { DataTableProps, KanbanProps, CalendarProps, TimelineProps, GalleryProps } from "./views";
export { RecordForm, RecordDetail } from "./record";
export type { RecordFormProps, RecordDetailProps } from "./record";
export { KpiCard, ChartCard } from "./metrics";
export type { KpiCardProps, ChartCardProps } from "./metrics";
export { FilterBar, FileDrop, CommandPalette, filterOf } from "./inputs";
export type { FilterBarProps, FilterValue, FileDropProps, CommandPaletteProps, PaletteCommand } from "./inputs";
export { BlockState, DEFAULT_LABELS, type Labels } from "./state";
export * from "./table";
export {
  formFields,
  initialValues,
  fieldError,
  typedValue,
  typedValues,
  recordSchema,
  errorTextEn,
  shown,
  monthGrid,
  byDay,
  type ErrorText,
  type FieldErrorKey,
  type Input,
  type Option,
  type ShowIf,
} from "./form";
