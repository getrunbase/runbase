import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Project rule: UI = shadcn/ui + Tailwind only.
const uiLibs = [
  "@mui/*",
  "@material-ui/*",
  "@chakra-ui/*",
  "@mantine/*",
  "antd",
  "antd/*",
  "@headlessui/*",
  "@nextui-org/*",
  "@heroui/*",
  "react-bootstrap",
  "semantic-ui-react",
  "primereact",
  "primereact/*",
];
const ui = { group: uiLibs, message: "UI: shadcn/ui + Tailwind only." };
const radix = {
  group: ["@radix-ui/*", "radix-ui"],
  message: "Radix is only allowed in components/ui (shadcn components).",
};
// React Flow = graph library, not a UI library: allowed only for the
// workflow editor canvas and the database schema diagram.
const xyflow = {
  group: ["@xyflow/*", "reactflow"],
  message:
    "React Flow is only allowed in the workflow canvas and the schema.",
};
// Monaco = code editor: allowed only for the functions editor.
const monaco = {
  group: ["@monaco-editor/*", "monaco-editor", "monaco-editor/*"],
  message: "Monaco is only allowed in the functions code editor.",
};
// Components provided by the design system: import directly from @getrunbase/ui,
// not through the re-exports of apps/web/components/ui.
const dsComponents = [
  "badge",
  "breadcrumb",
  "button",
  "card",
  "input",
  "label",
  "table",
  "tabs",
];
const ds = {
  group: dsComponents.map((c) => `@/components/ui/${c}`),
  message: "UI: import this component from @getrunbase/ui/components/ui/*.",
};
const restrict = (...patterns) => ({
  rules: {
    "no-restricted-imports": ["error", { patterns: [ds, ...patterns] }],
  },
});

// Project rule: colors = design system tokens only. No hard-coded
// hex/rgb/hsl/oklch color and no arbitrary Tailwind color class
// (bg-[#...]) outside packages/ui.
const colorRe =
  "/(^|[^&\\w])#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?![\\w-])|\\b(rgba?|hsla?|oklch|oklab|lab|lch)\\(\\s*[\\d.]|-\\[(#|rgb|hsl|oklch|color:)/";
const colorMsg =
  "Hard-coded color: use a design system token (@getrunbase/ui/theme.css).";
const colorSelectors = [
  { selector: `Literal[value=${colorRe}]`, message: colorMsg },
  { selector: `TemplateElement[value.raw=${colorRe}]`, message: colorMsg },
];
const colors = {
  files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
  ignores: ["packages/ui/**", "**/*.test.*"],
  rules: { "no-restricted-syntax": ["error", ...colorSelectors] },
};

// Project rule: user-facing core errors are appError (code + English
// template, translated in apps/web/messages/fr/errors). A bare Error is
// only for internal invariants, marked with an eslint-disable comment.
const errorMsg =
  "core: throw appError(\"domain.camelName\", \"English template\") (@getrunbase/core/errors), not Error.";
const coreErrors = {
  files: ["packages/core/src/**/*.ts"],
  ignores: ["**/*.test.*", "**/test-*.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      ...colorSelectors,
      { selector: "NewExpression[callee.name='Error']", message: errorMsg },
      { selector: "CallExpression[callee.name='Error']", message: errorMsg },
    ],
  },
};

// Project rule: no hard-coded UI text, everything goes through next-intl
// (messages/<locale>/<ns>.json). See docs/i18n.md. The docs site
// (apps/docs) follows the same rule with its own messages files.
const i18n = {
  files: [
    "apps/web/app/**/*.tsx",
    "apps/web/components/**/*.tsx",
    "apps/docs/app/**/*.tsx",
    "apps/docs/components/**/*.tsx",
    "apps/docs/lib/**/*.tsx",
  ],
  ignores: ["apps/web/components/ui/**", "apps/web/app/api/**", "**/*.test.*"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "JSXText[value=/[A-Za-zÀ-ÿ]{2}/]",
        message: "i18n: hard-coded text, use t('key') (docs/i18n.md).",
      },
      {
        // Same text hidden in an expression: <p>{"Sign in"}</p>.
        selector:
          ":matches(JSXElement, JSXFragment) > JSXExpressionContainer > Literal[value=/[A-Za-zÀ-ÿ]{2}/]",
        message: "i18n: hard-coded text, use t('key') (docs/i18n.md).",
      },
      {
        selector:
          "JSXAttribute[name.name=/^(placeholder|title|alt|label|description|aria-label)$/] > Literal[value=/[A-Za-zÀ-ÿ]{2}/]",
        message: "i18n: hard-coded attribute, use t('key') (docs/i18n.md).",
      },
      {
        selector: "Literal[value=/^(fr-FR|en-US)$/]",
        message: "i18n: hard-coded locale, use useFormatter/getFormatter.",
      },
      ...colorSelectors,
    ],
  },
};

// Project rule: server actions return actionError(e) (translated on the
// client by useErrorText), never a text translated on the server.
const actions = {
  files: ["apps/web/app/**/actions.ts", "apps/web/app/**/*-actions.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [ds, ui, radix, xyflow, monaco],
        paths: [
          {
            name: "@/lib/error-text-server",
            message:
              "Server actions: return { error: actionError(e) } (@/lib/action-error).",
          },
        ],
      },
    ],
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      ".claude/**",
      "**/*.gen.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  restrict(ui, radix, xyflow, monaco),
  colors,
  coreErrors,
  { files: ["**/components/ui/**"], ...restrict(ui, xyflow, monaco) },
  {
    files: [
      "apps/web/app/workflows/[[]id]/canvas.tsx",
      "apps/web/app/databases/[[]slug]/schema-graph.tsx",
      "apps/web/components/code-runtime/modules.ts",
    ],
    ...restrict(ui, radix, monaco),
  },
  {
    files: ["apps/web/app/functions/code-editor.tsx"],
    ...restrict(ui, radix, xyflow),
  },
  i18n,
  actions,
);
