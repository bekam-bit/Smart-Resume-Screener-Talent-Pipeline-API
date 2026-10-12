import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  API_PREFIX: z.string().regex(/^\/[A-Za-z0-9/_-]*$/).default("/api/v1"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required")
});

export const env = envSchema.parse(process.env);