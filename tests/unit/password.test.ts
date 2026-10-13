import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/utils/password.js";

describe("password hashing", () => {
  it("verifies Argon2id hashes and rejects the wrong password", async () => {
    const hash = await hashPassword("correct-password-2026");

    await expect(verifyPassword(hash, "correct-password-2026")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-password-2026")).resolves.toBe(false);
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });
});