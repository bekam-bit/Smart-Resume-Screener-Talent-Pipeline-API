import { createHash, randomBytes } from "node:crypto";

export const createOneTimeToken = () => randomBytes(32).toString("base64url");

export const hashOneTimeToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");