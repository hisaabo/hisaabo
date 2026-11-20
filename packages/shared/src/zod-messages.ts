/**
 * Default zod error messages, kept in the wording zod 3 used.
 *
 * zod 4 rewrote its English messages ("Required" became "Invalid input:
 * expected string, received undefined", "String must contain at least 1
 * character(s)" became "Too small: expected string to have >=1 characters").
 * Users see these texts in import row errors and API validation errors, so
 * the upgrade keeps the old wording. Messages a schema sets itself always win;
 * anything not covered here falls back to zod's own locale.
 *
 * Installed globally (`z.config`) as a side effect of importing
 * `@hisaabo/shared`, which every package that validates input does.
 */
import { z } from "zod";

type Issue = Parameters<NonNullable<z.core.$ZodConfig["customError"]>>[0];

function receivedType(input: unknown): string {
  switch (typeof input) {
    case "number":
      return Number.isNaN(input) ? "nan" : "number";
    case "object":
      if (input === null) return "null";
      if (Array.isArray(input)) return "array";
      if (input instanceof Date) return "date";
      if (input instanceof Map) return "map";
      if (input instanceof Set) return "set";
      if (input instanceof Promise) return "promise";
      return "object";
    default:
      return typeof input;
  }
}

const quoted = (v: unknown) => (typeof v === "string" ? `'${v}'` : String(v));

export function zod3Message(issue: Issue): string | undefined {
  switch (issue.code) {
    case "invalid_type": {
      if (issue.input === undefined) return "Required";
      if (issue.expected === "int" && typeof issue.input === "number") {
        return "Expected integer, received float";
      }
      const expected = issue.expected === "int" ? "integer" : issue.expected;
      return `Expected ${expected}, received ${receivedType(issue.input)}`;
    }
    case "too_small": {
      const { minimum, inclusive, exact } = issue;
      switch (issue.origin) {
        case "array":
        case "set":
          return `Array must contain ${exact ? "exactly" : inclusive ? "at least" : "more than"} ${minimum} element(s)`;
        case "string":
          return `String must contain ${exact ? "exactly" : inclusive ? "at least" : "over"} ${minimum} character(s)`;
        case "number":
        case "int":
        case "bigint":
          return `Number must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${minimum}`;
        case "date":
          return `Date must be ${exact ? "exactly equal to " : inclusive ? "greater than or equal to " : "greater than "}${new Date(Number(minimum))}`;
        default:
          return "Invalid input";
      }
    }
    case "too_big": {
      const { maximum, inclusive, exact } = issue;
      switch (issue.origin) {
        case "array":
        case "set":
          return `Array must contain ${exact ? "exactly" : inclusive ? "at most" : "less than"} ${maximum} element(s)`;
        case "string":
          return `String must contain ${exact ? "exactly" : inclusive ? "at most" : "under"} ${maximum} character(s)`;
        case "number":
        case "int":
          return `Number must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
        case "bigint":
          return `BigInt must be ${exact ? "exactly" : inclusive ? "less than or equal to" : "less than"} ${maximum}`;
        case "date":
          return `Date must be ${exact ? "exactly" : inclusive ? "smaller than or equal to" : "smaller than"} ${new Date(Number(maximum))}`;
        default:
          return "Invalid input";
      }
    }
    case "invalid_format":
      switch (issue.format) {
        case "regex":
          return "Invalid";
        case "starts_with":
          return `Invalid input: must start with "${(issue as { prefix?: string }).prefix}"`;
        case "ends_with":
          return `Invalid input: must end with "${(issue as { suffix?: string }).suffix}"`;
        case "includes":
          return `Invalid input: must include "${(issue as { includes?: string }).includes}"`;
        case "guid":
          return "Invalid uuid";
        default:
          return `Invalid ${issue.format}`;
      }
    case "not_multiple_of":
      return `Number must be a multiple of ${issue.divisor}`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${issue.keys.map((k) => `'${k}'`).join(", ")}`;
    case "invalid_value": {
      if ((issue.inst?._zod.def as { type?: string } | undefined)?.type === "literal" && issue.values.length === 1) {
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      }
      return `Invalid enum value. Expected ${issue.values.map(quoted).join(" | ")}, received '${String(issue.input)}'`;
    }
    case "invalid_union":
      // zod 4 already words a discriminator miss the way zod 3 did.
      return "discriminator" in issue ? undefined : "Invalid input";
    case "invalid_key":
    case "invalid_element":
    case "custom":
      return "Invalid input";
    default:
      return undefined;
  }
}

z.config({ customError: zod3Message });
