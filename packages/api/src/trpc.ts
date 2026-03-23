import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context.js";

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? undefined : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

// Auth middleware — requires a valid session
const isAuthenticated = t.middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be logged in" });
  }
  return next({ ctx: { user: ctx.user } });
});

// Business middleware — requires auth + active business
const hasBusinessAccess = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!ctx.businessId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No business selected" });
  }

  // TODO: In production, verify user actually has access to this business
  // via a business_members table for multi-user support

  return next({
    ctx: {
      user: ctx.user,
      businessId: ctx.businessId,
    },
  });
});

export const protectedProcedure = t.procedure.use(isAuthenticated);
export const businessProcedure = t.procedure.use(hasBusinessAccess);
