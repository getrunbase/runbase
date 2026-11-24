import { createCn } from "cn/config";

// App `cn` (tsconfig alias "cn"): board text sizes p19
// (theme.css) declared so that `text-tiny` and `text-muted-foreground`
// do not override each other on merge.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "tiny", "md", "brand", "lead", "h3", "h2", "h1", "display"] },
      ],
      leading: [{ leading: ["node"] }],
      tracking: [{ tracking: ["page", "brand"] }],
      "font-family": [{ font: ["mono", "sans"] }],
      rounded: [{ rounded: ["2xs", "tile"] }],
    },
  },
});
