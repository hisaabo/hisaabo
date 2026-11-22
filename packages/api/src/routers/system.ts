import { router, publicProcedure } from "../trpc.js";
import { getMaintenanceStatus } from "../lib/maintenance-cache.js";
import { isMultiTenant, isSignupOpen } from "../lib/signup-policy.js";
import { isWebMcpDisabledByOperator } from "../lib/webmcp-policy.js";

export const systemRouter = router({
  maintenanceStatus: publicProcedure.query(async () => {
    return getMaintenanceStatus();
  }),

  config: publicProcedure.query(async () => {
    // webmcpDisabled: the operator's WEBMCP_DISABLED kill switch. The web app reads it
    // before registering any browser AI agent tools (see lib/webmcp-policy.ts).
    return { multiTenant: isMultiTenant(), signupOpen: await isSignupOpen(), webmcpDisabled: isWebMcpDisabledByOperator() };
  }),
});
