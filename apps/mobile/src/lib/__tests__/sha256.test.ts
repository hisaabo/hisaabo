import { createHash } from "crypto";
import { sha256Hex } from "../sha256";

describe("sha256Hex", () => {
  it.each(["", "abc", "1234", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(200)])(
    "matches node crypto for %j",
    (input) => {
      expect(sha256Hex(input)).toBe(createHash("sha256").update(input, "latin1").digest("hex"));
    },
  );
});
