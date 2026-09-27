/**
 * Shared plumbing for the REST route handlers: one response envelope, one
 * error shape, one place where authentication is enforced.
 *
 * Errors always come back as `{ error: string, details?: Record<string, string> }`
 * so the client has a single branch to render, whether the failure was a
 * validation problem, a missing row or an unexpected exception.
 */

import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { fieldErrors } from "@/lib/validation";
import { getSessionUser } from "./auth";
import type { SessionUser } from "@/lib/types";
import { AiError } from "./ai";
import { PipelineError } from "./pipeline";

export interface ApiError {
  error: string;
  details?: Record<string, string>;
}

export function jsonError(status: number, error: string, details?: Record<string, string>) {
  return NextResponse.json<ApiError>({ error, ...(details ? { details } : {}) }, { status });
}

export function validationError(error: ZodError) {
  return jsonError(422, "Validation failed", fieldErrors(error));
}

/** Thrown by `requireSession` and converted to a 401 by `route`. */
class UnauthorizedError extends Error {}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** Parses a `[id]` path segment, rejecting anything that is not a positive integer. */
export function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Wraps a handler so that unauthenticated requests become 401s and unexpected
 * exceptions become 500s instead of leaking a stack trace to the client.
 */
export function route<Args extends unknown[]>(
  handler: (...args: Args) => Promise<NextResponse>,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return jsonError(401, "Authentication required");
      }
      // Failures with a message written for the user are passed through.
      if (error instanceof PipelineError) return jsonError(422, error.message);
      if (error instanceof AiError) return jsonError(502, error.message);
      console.error("[api] unhandled error", error);
      return jsonError(500, "Something went wrong on our end");
    }
  };
}
