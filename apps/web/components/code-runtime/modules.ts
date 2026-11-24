// Modules provided to code components (imports allowed by compilation):
// React, recharts, date-fns, headless libs (dnd-kit, tanstack, react-hook-form,
// zod, motion, xyflow, react-markdown, react-day-picker), @runbase/kit and all the
// app's shadcn components, exposed as `@ui/<name>` (modules.test.ts
// checks that none is missing). tiptap and maplibre are lazy: separate
// chunks, loaded only if the bundle imports them (lazyChunks).
// lucide-react is not one of them: it is bundled per component.
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as dateFns from "date-fns";
import * as recharts from "recharts";
import * as dndCore from "@dnd-kit/core";
import * as dndSortable from "@dnd-kit/sortable";
import * as dndUtilities from "@dnd-kit/utilities";
import * as reactTable from "@tanstack/react-table";
import * as reactVirtual from "@tanstack/react-virtual";
import * as reactHookForm from "react-hook-form";
import * as zod from "zod";
import * as motion from "motion/react";
import * as xyflow from "@xyflow/react";
import * as reactMarkdown from "react-markdown";
import * as dayPicker from "react-day-picker";
import * as kit from "@runbase/kit";
import * as accordion from "@/components/ui/accordion";
import * as alert from "@/components/ui/alert";
import * as alertDialog from "@/components/ui/alert-dialog";
import * as aspectRatio from "@/components/ui/aspect-ratio";
import * as avatar from "@/components/ui/avatar";
import * as badge from "@runbase/ui/components/ui/badge";
import * as breadcrumb from "@runbase/ui/components/ui/breadcrumb";
import * as button from "@runbase/ui/components/ui/button";
import * as buttonGroup from "@/components/ui/button-group";
import * as calendar from "@/components/ui/calendar";
import * as card from "@runbase/ui/components/ui/card";
import * as carousel from "@/components/ui/carousel";
import * as chart from "@/components/ui/chart";
import * as checkbox from "@/components/ui/checkbox";
import * as collapsible from "@/components/ui/collapsible";
import * as command from "@/components/ui/command";
import * as contextMenu from "@/components/ui/context-menu";
import * as dialog from "@/components/ui/dialog";
import * as dropdownMenu from "@/components/ui/dropdown-menu";
import * as empty from "@/components/ui/empty";
import * as field from "@/components/ui/field";
import * as form from "@/components/ui/form";
import * as hoverCard from "@/components/ui/hover-card";
import * as input from "@runbase/ui/components/ui/input";
import * as inputOtp from "@/components/ui/input-otp";
import * as item from "@/components/ui/item";
import * as kbd from "@/components/ui/kbd";
import * as label from "@runbase/ui/components/ui/label";
import * as menubar from "@/components/ui/menubar";
import * as navigationMenu from "@/components/ui/navigation-menu";
import * as pagination from "@/components/ui/pagination";
import * as popover from "@/components/ui/popover";
import * as progress from "@/components/ui/progress";
import * as radioGroup from "@/components/ui/radio-group";
import * as resizable from "@/components/ui/resizable";
import * as scrollArea from "@/components/ui/scroll-area";
import * as select from "@/components/ui/select";
import * as separator from "@/components/ui/separator";
import * as sheet from "@/components/ui/sheet";
import * as sidebar from "@/components/ui/sidebar";
import * as skeleton from "@/components/ui/skeleton";
import * as slider from "@/components/ui/slider";
import * as sonner from "@/components/ui/sonner";
import * as spinner from "@/components/ui/spinner";
import * as switchUi from "@/components/ui/switch";
import * as table from "@runbase/ui/components/ui/table";
import * as tabs from "@runbase/ui/components/ui/tabs";
import * as textarea from "@/components/ui/textarea";
import * as toggle from "@/components/ui/toggle";
import * as toggleGroup from "@/components/ui/toggle-group";
import * as tooltip from "@/components/ui/tooltip";

export const modules: Record<string, unknown> = {
  react: React,
  "react-dom": ReactDOM,
  "react/jsx-runtime": jsxRuntime,
  "date-fns": dateFns,
  recharts,
  "@dnd-kit/core": dndCore,
  "@dnd-kit/sortable": dndSortable,
  "@dnd-kit/utilities": dndUtilities,
  "@tanstack/react-table": reactTable,
  "@tanstack/react-virtual": reactVirtual,
  "react-hook-form": reactHookForm,
  zod,
  motion,
  "motion/react": motion,
  "@xyflow/react": xyflow,
  "react-markdown": reactMarkdown,
  "react-day-picker": dayPicker,
  // Data-bound blocks (hooks read from __vendor["@runbase/sdk"]).
  "@runbase/kit": kit,
  "@ui/accordion": accordion,
  "@ui/alert": alert,
  "@ui/alert-dialog": alertDialog,
  "@ui/aspect-ratio": aspectRatio,
  "@ui/avatar": avatar,
  "@ui/badge": badge,
  "@ui/breadcrumb": breadcrumb,
  "@ui/button": button,
  "@ui/button-group": buttonGroup,
  "@ui/calendar": calendar,
  "@ui/card": card,
  "@ui/carousel": carousel,
  "@ui/chart": chart,
  "@ui/checkbox": checkbox,
  "@ui/collapsible": collapsible,
  "@ui/command": command,
  "@ui/context-menu": contextMenu,
  "@ui/dialog": dialog,
  "@ui/dropdown-menu": dropdownMenu,
  "@ui/empty": empty,
  "@ui/field": field,
  "@ui/form": form,
  "@ui/hover-card": hoverCard,
  "@ui/input": input,
  "@ui/input-otp": inputOtp,
  "@ui/item": item,
  "@ui/kbd": kbd,
  "@ui/label": label,
  "@ui/menubar": menubar,
  "@ui/navigation-menu": navigationMenu,
  "@ui/pagination": pagination,
  "@ui/popover": popover,
  "@ui/progress": progress,
  "@ui/radio-group": radioGroup,
  "@ui/resizable": resizable,
  "@ui/scroll-area": scrollArea,
  "@ui/select": select,
  "@ui/separator": separator,
  "@ui/sheet": sheet,
  "@ui/sidebar": sidebar,
  "@ui/skeleton": skeleton,
  "@ui/slider": slider,
  "@ui/sonner": sonner,
  "@ui/spinner": spinner,
  "@ui/switch": switchUi,
  "@ui/table": table,
  "@ui/tabs": tabs,
  "@ui/textarea": textarea,
  "@ui/toggle": toggle,
  "@ui/toggle-group": toggleGroup,
  "@ui/tooltip": tooltip,
};

// Heavy modules outside the initial vendor: name -> chunk (components/code-runtime/
// chunks/<chunk>.ts), served by /c/runtime/chunk/<chunk>.
export const lazyModules: Record<string, string> = {
  "@tiptap/react": "tiptap",
  "@tiptap/starter-kit": "tiptap",
  "maplibre-gl": "maplibre",
};

// Lazy chunks referenced by a compiled bundle (`__vendor["<name>"]`).
export const lazyChunks = (bundle: string) => [
  ...new Set(
    Object.entries(lazyModules)
      .filter(([name]) => bundle.includes(`__vendor[${JSON.stringify(name)}]`))
      .map(([, chunk]) => chunk),
  ),
];
