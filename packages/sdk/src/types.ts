// Public API of `@getrunbase/sdk` as seen by a code component (hooks
// provided by the iframe runtime).
export type Row = {
  id: string;
  objectId: string;
  data: Record<string, unknown>;
} & Record<string, unknown>;

export type Filter = Record<string, unknown>;
export type Sort = { field: string; dir?: "asc" | "desc" }[];
export type Aggregation = {
  op: "count" | "sum" | "avg" | "min" | "max";
  field?: string;
  as: string;
};

export type QueryArgs = {
  object: string;
  filter?: Filter;
  sort?: Sort;
  q?: string;
  limit?: number;
  // `false`: no request (e.g. waiting for a selection).
  enabled?: boolean;
};

export type Loadable<T> = {
  data: T;
  loading: boolean;
  error?: string;
  reload: () => void;
};

export type QueryResult<R = Row> = Loadable<R[]> & {
  total: number;
  hasMore: boolean;
  fetchMore: () => void;
};

export type InfiniteQueryResult<R = Row> = Loadable<R[]> & {
  total: number;
  hasNextPage: boolean;
  fetchNextPage: () => void;
};

export type AggregateArgs = {
  object: string;
  filter?: Filter;
  q?: string;
  groupBy?: string | string[];
  aggregate: Aggregation[];
  limit?: number;
  enabled?: boolean;
};

export type MutationResult<T = Row> =
  { ok: true; data: T } | { ok: false; error: string };
export type MutationOptions = { optimistic?: boolean; success?: string };
export type Mutation = {
  pending: boolean;
  create: (
    data: Record<string, unknown>,
    opts?: MutationOptions & { object?: string },
  ) => Promise<MutationResult>;
  update: (
    id: string,
    patch: Record<string, unknown>,
    opts?: MutationOptions,
  ) => Promise<MutationResult>;
  remove: (
    id: string,
    opts?: MutationOptions,
  ) => Promise<MutationResult<{ id: string; deleted: true }>>;
};

export type FileValue = {
  key: string;
  name: string;
  type: string;
  size: number;
};
export type Upload = {
  upload: (file: File) => Promise<MutationResult<FileValue>>;
  pending: boolean;
  error?: string;
};

export type RunStatus =
  "running" | "waiting" | "succeeded" | "failed" | "canceled" | (string & {});
export type RunState = {
  runId: string;
  status: RunStatus;
  error?: string | null;
};
export type Run = {
  start: (opts?: { recordId?: string }) => Promise<RunState>;
  run: RunState | null;
  running: boolean;
};

// useAI (`ai` permission): text completion counted against the workspace AI
// budget; clear refusal if the budget or credit is exhausted, or the rate is exceeded.
export type AI = {
  ask: (
    prompt: string,
    opts?: { system?: string },
  ) => Promise<MutationResult<{ text: string }>>;
  text?: string;
  pending: boolean;
  error?: string;
};

export type User = { id: string; name?: string; email?: string } | null;

export interface RunbaseSdk {
  useQuery<R = Row>(args: QueryArgs): QueryResult<R>;
  useInfiniteQuery<R = Row>(args: QueryArgs): InfiniteQueryResult<R>;
  useAggregate<R = Record<string, unknown>>(args: AggregateArgs): Loadable<R[]>;
  useMutation(object?: string): Mutation;
  useUpload(): Upload;
  useRun(workflowId: string): Run;
  useAI(): AI;
  useRecord<R = Row>(
    id: string | null | undefined,
    opts?: { include?: string[] },
  ): Loadable<R | undefined>;
  useTimeline<E = Record<string, unknown>>(
    recordId: string | null | undefined,
  ): Loadable<E[]>;
  useObject(id: string | null | undefined): Loadable<unknown>;
  useUser(): User;
  useParam<T>(key: string, initial: T): readonly [T, (next: T) => void];
  useNow(ms?: number): number;
  now(): Date;
  toast(text: string, level?: "info" | "success" | "error"): void;
  navigate(to: { page: string; recordId?: string }): void;
  startWorkflow(
    id: string,
    opts?: { recordId?: string },
  ): Promise<{ runId: string; status: RunStatus }>;
}
