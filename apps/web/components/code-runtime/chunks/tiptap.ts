// Lazy tiptap chunk: a single chunk for @tiptap/react and @tiptap/starter-kit
// (same @tiptap/core). React comes from the vendor (see lib/code-runtime.ts).
import * as react from "@tiptap/react";
import * as starterKit from "@tiptap/starter-kit";

Object.assign((globalThis as unknown as { __vendor: object }).__vendor, {
  "@tiptap/react": react,
  "@tiptap/starter-kit": starterKit,
});
