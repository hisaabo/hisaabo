/**
 * zod 4 ships different default messages; `zod-messages.ts` keeps the zod 3
 * wording users already see in import and API validation errors. Each
 * expectation below is the exact text zod 3.25 produced for the same input.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import "../zod-messages.js";
import { createPartySchema } from "../validators.js";

function message(schema: z.ZodType, input: unknown): string {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("expected a validation failure");
  return result.error.issues[0]!.message;
}

describe("zod 3 default messages", () => {
  it("missing and mistyped values", () => {
    expect(message(z.object({ name: z.string() }), {})).toBe("Required");
    expect(message(z.string(), 5)).toBe("Expected string, received number");
    expect(message(z.number(), "5")).toBe("Expected number, received string");
    expect(message(z.number(), null)).toBe("Expected number, received null");
    expect(message(z.array(z.string()), {})).toBe("Expected array, received object");
    expect(message(z.number().int(), 1.5)).toBe("Expected integer, received float");
  });

  it("string, number and array bounds", () => {
    expect(message(z.string().min(1), "")).toBe("String must contain at least 1 character(s)");
    expect(message(z.string().max(3), "abcd")).toBe("String must contain at most 3 character(s)");
    expect(message(z.string().length(2), "a")).toBe("String must contain exactly 2 character(s)");
    expect(message(z.number().min(0), -1)).toBe("Number must be greater than or equal to 0");
    expect(message(z.number().positive(), 0)).toBe("Number must be greater than 0");
    expect(message(z.number().max(100), 101)).toBe("Number must be less than or equal to 100");
    expect(message(z.number().lt(5), 5)).toBe("Number must be less than 5");
    expect(message(z.array(z.string()).min(1), [])).toBe("Array must contain at least 1 element(s)");
    expect(message(z.array(z.string()).max(1), ["a", "b"])).toBe("Array must contain at most 1 element(s)");
    expect(message(z.number().multipleOf(5), 7)).toBe("Number must be a multiple of 5");
  });

  it("string formats", () => {
    expect(message(z.string().uuid(), "nope")).toBe("Invalid uuid");
    expect(message(z.string().email(), "nope")).toBe("Invalid email");
    expect(message(z.string().url(), "nope")).toBe("Invalid url");
    expect(message(z.string().datetime(), "2024-01-01")).toBe("Invalid datetime");
    expect(message(z.string().date(), "2024-13-01")).toBe("Invalid date");
    expect(message(z.string().regex(/^\d+$/), "abc")).toBe("Invalid");
    expect(message(z.string().startsWith("x"), "abc")).toBe('Invalid input: must start with "x"');
  });

  it("enums, literals, unions and objects", () => {
    expect(message(z.enum(["cash", "upi"]), "card")).toBe(
      "Invalid enum value. Expected 'cash' | 'upi', received 'card'",
    );
    expect(message(z.literal("a"), "b")).toBe('Invalid literal value, expected "a"');
    expect(message(z.union([z.string(), z.number()]), true)).toBe("Invalid input");
    expect(
      message(
        z.discriminatedUnion("t", [z.object({ t: z.literal("a") }), z.object({ t: z.literal("b") })]),
        { t: "c" },
      ),
    ).toBe("Invalid discriminator value. Expected 'a' | 'b'");
    expect(message(z.object({ a: z.string() }).strict(), { a: "x", b: 1 })).toBe(
      "Unrecognized key(s) in object: 'b'",
    );
    expect(message(z.string().refine(() => false), "x")).toBe("Invalid input");
  });

  it("messages a schema sets itself still win", () => {
    expect(message(z.string().min(1, "Name is required"), "")).toBe("Name is required");
    expect(message(z.string().min(1, { message: "Too short" }), "")).toBe("Too short");
    expect(message(z.string().min(1, { error: "Too short" }), "")).toBe("Too short");
  });

  it("applies to the shared validators", () => {
    const result = createPartySchema.safeParse({ type: "customer" });
    expect(result.success).toBe(false);
    expect(result.error!.issues.find((i) => i.path[0] === "name")?.message).toBe("Required");
  });
});
