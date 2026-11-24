// Chunk lazy maplibre-gl.
import * as maplibre from "maplibre-gl";

Object.assign((globalThis as unknown as { __vendor: object }).__vendor, {
  "maplibre-gl": maplibre,
});
