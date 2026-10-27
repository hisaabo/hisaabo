/**
 * Input-validation errors reach users as the tRPC error message (web toasts,
 * CLI and MCP output). The formatter turns zod issues into "path: message"
 * lines instead of zod's issue JSON, whose shape differs between versions.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createPartySchema } from "@hisaabo/shared";
import { router, formatZodIssues } from "../trpc.js";

const errorFormatter = router({})._def._config.errorFormatter;

function format(error: TRPCError) {
  const shape = {
    message: error.message,
    code: -32600,
    data: { code: error.code, httpStatus: 400 },
  };
  return errorFormatter({ shape, error, type: "mutation", path: "party.create", input: {}, ctx: undefined } as never);
}

describe("validation error messages", () => {
  const invalid = createPartySchema.safeParse({ type: "vendor", name: "", email: "x" });

  it("lists each issue with its field path", () => {
    expect(invalid.success).toBe(false);
    expect(formatZodIssues(invalid.error!)).toBe(
      [
        "type: Invalid enum value. Expected 'customer' | 'supplier', received 'vendor'",
        "name: String must contain at least 1 character(s)",
        "email: Invalid email",
      ].join("\n"),
    );
  });

  it("is what the client receives for a BAD_REQUEST caused by input parsing", () => {
    const error = new TRPCError({ code: "BAD_REQUEST", cause: invalid.error });
    expect(format(error).message).toBe(formatZodIssues(invalid.error!));
  });

  it("omits the path for top-level issues", () => {
    const r = z.string().uuid().safeParse("nope");
    expect(formatZodIssues(r.error!)).toBe("Invalid uuid");
  });

  it("leaves hand-written errors and internal errors alone", () => {
    expect(format(new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" })).message).toBe("Invoice not found");
    expect(
      format(new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: new z.ZodError([]) })).message,
    ).toBe("Something went wrong. Please try again.");
  });
});
