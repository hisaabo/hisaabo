import { router, publicProcedure } from "../trpc.js";
import { getMaintenanceStatus } from "../lib/maintenance-cache.js";

export const systemRouter = router({
  maintenanceStatus: publicProcedure.query(async () => {
    return getMaintenanceStatus();
  }),
});
