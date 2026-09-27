/** /api/sources/[id] - stop watching a board. */

import { NextResponse } from "next/server";
import { jsonError, parseId, requireSession, route } from "@/server/api";
import { deleteSource } from "@/server/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const user = await requireSession();
  const id = parseId((await context.params).id);
  if (!id) return jsonError(404, "Source not found");

  if (!(await deleteSource(user.id, id))) return jsonError(404, "Source not found");
  return new NextResponse(null, { status: 204 });
});
