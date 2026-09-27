/**
 * Server-side authentication.
 *
 * A successful login mints a signed JWT (see `@/lib/session`) and stores it in
 * an httpOnly cookie, so the token is never readable from JavaScript and is
 * sent automatically with same-site requests. Passwords are stored as bcrypt
 * hashes, and no query in this module lets a hash escape it.
 */

import { cookies } from "next/headers";
import { getDb } from "./db";
import { getDecoyHash, verifyPassword } from "./password";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/session";
import type { SessionUser } from "@/lib/types";

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const db = await getDb();
  const { rows } = await db.query<{
    id: number;
    name: string;
    email: string;
    password_hash: string;
  }>(`SELECT id, name, email, password_hash FROM users WHERE email = $1`, [email.toLowerCase()]);

  const user = rows[0];
  const matches = await verifyPassword(password, user?.password_hash ?? getDecoyHash());
  if (!user || !matches) return null;

  return { id: user.id, name: user.name, email: user.email };
}

export async function startSession(user: SessionUser): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The signed-in user for the current request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
