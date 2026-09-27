/** /api/auth/signup - creates an account and signs it in. */

import { NextResponse, type NextRequest } from "next/server";
import { startSession } from "@/server/auth";
import { jsonError, route, validationError } from "@/server/api";
import { EmailTakenError, createUser } from "@/server/repo";
import { signupSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (request: NextRequest) => {
  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const user = await createUser(parsed.data);
    await startSession(user);
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return jsonError(422, "Validation failed", { email: "An account with this email already exists" });
    }
    throw error;
  }
});
