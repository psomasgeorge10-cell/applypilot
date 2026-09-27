/** /api/auth/login - exchanges credentials for a session cookie. */

import { NextResponse, type NextRequest } from "next/server";
import { authenticate, startSession } from "@/server/auth";
import { jsonError, route, validationError } from "@/server/api";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const user = await authenticate(parsed.data.email, parsed.data.password);
  // Deliberately vague: never reveal whether it was the email or the password.
  if (!user) return jsonError(401, "Incorrect email or password");

  await startSession(user);
  return NextResponse.json(user);
});
