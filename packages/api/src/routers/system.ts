import { router, publicProcedure } from "../trpc.js";
import { getMaintenanceStatus } from "../lib/maintenance-cache.js";
import { isMultiTenant, isSignupOpen } from "../lib/signup-policy.js";

export const systemRouter = router({
  maintenanceStatus: publicProcedure.query(async () => {
    return getMaintenanceStatus();
  }),

  config: publicProcedure.query(async () => {
    return { multiTenant: isMultiTenant(), signupOpen: await isSignupOpen() };
  }),
});
