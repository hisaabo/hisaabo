import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { hsnSearchSchema } from "@hisaabo/shared";
import { searchHsn, isValidHsn, validateHsnForTurnover } from "../lib/hsn-data.js";

export const hsnRouter = router({
  search: publicProcedure
    .input(hsnSearchSchema)
    .query(({ input }) => {
      return searchHsn(input.query, { type: input.type, limit: input.limit });
    }),

  validate: publicProcedure
    .input(z.object({ hsn: z.string().min(2).max(8) }))
    .query(({ input }) => {
      return { valid: isValidHsn(input.hsn) };
    }),

  validateForTurnover: publicProcedure
    .input(z.object({
      hsn: z.string().min(2).max(8),
      annualTurnover: z.string(),
    }))
    .query(({ input }) => {
      return validateHsnForTurnover(input.hsn, input.annualTurnover);
    }),
});
