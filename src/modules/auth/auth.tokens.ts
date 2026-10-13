import { createHash, randomBytes, randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { env } from "../../config/env.js";

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const accessIssuer = "smart-resume-screener-api";
const accessAudience = "smart-resume-screener-client";
const accessPayloadSchema = z.object({
  type: z.literal("access"),
  sub: z.string().uuid(),
  iss: z.literal(accessIssuer),
  aud: z.literal(accessAudience),
  iat: z.number(),
  exp: z.number(),
  jti: z.string().uuid()
});

export const createAccessToken = (userId: string) => new SignJWT({ type: "access" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuer(accessIssuer)
  .setAudience(accessAudience)
  .setJti(randomUUID())
  .setIssuedAt()
  .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
  .sign(accessSecret);

export const verifyAccessToken = async (token: string) => {
  const { payload } = await jwtVerify(token, accessSecret, {
    algorithms: ["HS256"],
    issuer: accessIssuer,
    audience: accessAudience
  });
  const parsed = accessPayloadSchema.parse(payload);
  return { userId: parsed.sub };
};

export const createRefreshToken = () => randomBytes(48).toString("base64url");

export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");