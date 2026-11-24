// Loaded before React: a native MessageChannel keeps a port open that
// would stop the Deno process from exiting; replaced with setTimeout.
class Channel {
  port1: { onmessage?: (e: unknown) => void } = {};
  port2 = {
    postMessage: (data: unknown) =>
      setTimeout(() => this.port1.onmessage?.({ data })),
  };
}
(globalThis as Record<string, unknown>).MessageChannel = Channel;
