import { parse, serialize } from "cookie";
import type { Request, Response } from "express";
import { env } from "../../config/env.js";

export const refreshCookieName = "refresh_token";

export const readRefreshToken = (request: Request) => parse(request.headers.cookie ?? "")[refreshCookieName];

export const setRefreshCookie = (response: Response, token: string) => {
  response.setHeader("Set-Cookie", serialize(refreshCookieName, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.NODE_ENV === "production",
    sameSite: "lax",
    path: `${env.API_PREFIX}/auth`,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS
  }));
};

export const clearRefreshCookie = (response: Response) => {
  response.setHeader("Set-Cookie", serialize(refreshCookieName, "", {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.NODE_ENV === "production",
    sameSite: "lax",
    path: `${env.API_PREFIX}/auth`,
    maxAge: 0
  }));
};