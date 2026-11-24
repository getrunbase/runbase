// Input schema of the catalog template import action.
import { z } from "zod";
import { id } from "@/lib/action-input";

export const catalogInput = z.object({ template: id });
