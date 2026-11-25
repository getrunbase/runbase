import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// One index per language; the search dialog sends the page language.
export const { GET } = createFromSource(source);
