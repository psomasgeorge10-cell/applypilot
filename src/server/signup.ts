/**
 * Who may create an account.
 *
 * Every account spends the server's Anthropic credits, so a public deployment
 * should not be open to anyone who finds the URL. SIGNUP_ALLOWLIST takes a
 * comma-separated list of emails and/or `@domain.com` entries; `*` (or leaving
 * it unset) allows everyone.
 */

export function signupAllowed(email: string, allowlist = process.env.SIGNUP_ALLOWLIST): boolean {
  const entries = (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0 || entries.includes("*")) return true;

  const address = email.trim().toLowerCase();
  return entries.some((entry) => (entry.startsWith("@") ? address.endsWith(entry) : address === entry));
}
