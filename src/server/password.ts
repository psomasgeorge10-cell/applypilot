/**
 * Password hashing, kept separate from the rest of the auth module so that the
 * seed script can reuse it without pulling in `next/headers`, which only exists
 * inside a request.
 */

import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A real hash to compare against when an email is unknown, so a failed login
 * costs the same whether or not the account exists. Computed once, lazily.
 */
let decoyHash: string | undefined;
export function getDecoyHash(): string {
  decoyHash ??= bcrypt.hashSync("no-such-account", BCRYPT_ROUNDS);
  return decoyHash;
}
