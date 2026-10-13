import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(1).max(120)
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128)
});

export const tokenSchema = z.object({
  token: z.string().min(32).max(512)
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(512),
  password: z.string().min(12).max(128)
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email()
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TokenInput = z.infer<typeof tokenSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;