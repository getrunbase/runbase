// Connector logo: optional `logo.svg` in the connector folder, served as a
// data URL (block catalog in the editor, public catalog API).
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function logoDataUrl(dir: string): Promise<string | undefined> {
  try {
    const svg = await readFile(join(dir, "logo.svg"));
    return `data:image/svg+xml;base64,${svg.toString("base64")}`;
  } catch {
    return undefined;
  }
}
