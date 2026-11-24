// JSONB records: upsert by external_id with merge or replacement
// of `data`, validated against the object schema. Returns the modified fields.
import { bulkOps } from "./bulk-service";
import { readOps } from "./read-service";
import { trashOps } from "./trash-service";
import { writeOps } from "./write-service";

export type {
  AggregateInput,
  SearchInput,
  TransactOp,
  UpsertInput,
} from "./types";
export { MAX_BULK, MAX_TEMPLATE_HOPS, TRASH_DAYS } from "./types";
export { changedFields } from "./helpers";
export {
  publishUpsert,
  purgeExpiredRecords,
  removeInTx,
  updateInTx,
  upsertInTx,
} from "./write";

export const recordsService = {
  ...readOps,
  ...writeOps,
  ...trashOps,
  ...bulkOps,
};
