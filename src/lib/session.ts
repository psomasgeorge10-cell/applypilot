/**
 * Session token helpers.
 *
 * Deliberately dependency-light: this module is imported by the Edge
 * middleware as well as by Node route handlers, so it may only use APIs that
 * exist in both runtimes (`jose` and Web Crypto - no bcrypt, no database, no
 * `next/headers`).
 */

import { SignJWT, jwtVerify } from "jose";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "applypilot_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Development falls back to a fixed secret so the app runs straight after a
 * clone; production refuses to start without a real one.
 */
const DEV_SECRET = "dev-only-insecure-secret-change-me";

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET must be set in production");
    }
    return new TextEncoder().encode(DEV_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** Returns the user encoded in a token, or null when it is missing, forged or expired. */
export async function verifySessionToken(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) return null;
    return { id, name: String(payload.name ?? ""), email: String(payload.email ?? "") };
  } catch {
    // An unreadable token is simply an unauthenticated request.
    return null;
  }
}
