import "dotenv/config";
import { z } from "zod";

const emailAddressPattern = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/;
const emailFromSchema = z.string().refine((value) => {
  const match = value.match(/<([^<>]+)>$/);
  return emailAddressPattern.test(match?.[1] ?? value);
}, "EMAIL_FROM must be an email address or display name with an email address");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  API_PREFIX: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).default("/api/v1"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive(),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive(),
  COOKIE_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").default(false),
  FRONTEND_ORIGINS: z.string(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: emailFromSchema,
  FRONTEND_APP_URL: z.string(),

  // ── Object storage (Neon-compatible S3 endpoint) ──
  // The AWS SDK also reads these from the environment natively; declared here
  // so their presence/shape is validated at boot and reused by the provider.
  AWS_ENDPOINT_URL_S3: z.string().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  S3_BUCKET: z.string().default("resume-assets"),
  S3_PRESIGN_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),

  // ── Resume uploads ──
  MAX_RESUME_SIZE_BYTES: z.coerce.number().int().positive().default(5_242_880)
});

export const env = envSchema.parse(process.env);

if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY is required in production");
}

if (env.NODE_ENV === "production" && env.EMAIL_FROM === "onboarding@resend.dev") {
  throw new Error("EMAIL_FROM must be a verified production sender");
}