import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";

const options = {
  memorySize: 19_456,
  iterations: 2,
  parallelism: 1
} as const;

export const hashPassword = (password: string) => argon2id({
  password,
  salt: randomBytes(16),
  ...options,
  hashLength: 32,
  outputType: "encoded"
});

export const verifyPassword = async (hash: string, password: string) => {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
};