// @runbase/sdk hooks read at call time from the iframe vendor (real runtime
// or simulated SDK of the test harness): the @runbase/sdk package only exports
// types, the implementation is provided by the host.
import type { RunbaseSdk } from "@runbase/sdk";

export const sdk = (): RunbaseSdk => {
  const s = (globalThis as { __vendor?: Record<string, unknown> }).__vendor?.[
    "@runbase/sdk"
  ];
  if (!s) throw new Error("@runbase/kit: @runbase/sdk runtime not found");
  return s as RunbaseSdk;
};
