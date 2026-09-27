/**
 * Route protection.
 *
 * `proxy.ts` is Next.js 16's name for what used to be `middleware.ts`.
 *
 * It only checks the session cookie's signature - a cheap gate that keeps
 * anonymous visitors off the app and signed-in users off the login and sign-up
 * pages.
 * It is not the security boundary: every API route and the dashboard page
 * verify the session again on the server, so bypassing this still yields a 401
 * rather than data.
 */

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export default async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = await verifySessionToken(token);
  const isAuthPage = ["/login", "/signup"].includes(request.nextUrl.pathname);

  if (!user && !isAuthPage) {
    const login = new URL("/login", request.url);
    // Remember where they were headed so login can send them back.
    login.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  if (user && isAuthPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Page routes only. API routes enforce authentication themselves and must
  // answer with 401 JSON rather than a redirect to HTML.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\.svg).*)"],
};
