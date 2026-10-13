import { describe, expect, it } from "vitest";
import { createAccessToken, createRefreshToken, hashRefreshToken, verifyAccessToken } from "../../src/modules/auth/auth.tokens.js";

describe("auth token primitives", () => {
  it("creates a verifiable access token for a user", async () => {
    const userId = "123e4567-e89b-42d3-a456-426614174000";
    const token = await createAccessToken(userId);

    await expect(verifyAccessToken(token)).resolves.toEqual({ userId });
  });

  it("rejects a modified access token", async () => {
    const token = await createAccessToken("123e4567-e89b-42d3-a456-426614174000");
    const modifiedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    await expect(verifyAccessToken(modifiedToken)).rejects.toThrow();
  });

  it("creates unpredictable refresh material and a stable one-way hash", () => {
    const token = createRefreshToken();

    expect(token).toHaveLength(64);
    expect(hashRefreshToken(token)).toHaveLength(64);
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(token);
  });
});