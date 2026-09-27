/**
 * /api/sources
 *
 *   GET  - the company job boards the user watches
 *   POST - watch a board, given either `{ url }` (a careers-page link) or
 *          `{ ats, boardToken, company }`. The board is fetched once before it
 *          is saved, so a typo is caught here rather than on the next sync.
 */

import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireSession, route, validationError } from "@/server/api";
import { BoardNotFoundError, fetchBoard, parseBoardUrl } from "@/server/ats";
import { addSource, listSources, upsertJobs } from "@/server/repo";
import { sourceInputSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireSession();
  return NextResponse.json(await listSources(user.id));
});

function titleCase(token: string): string {
  return token
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export const POST = route(async (request: NextRequest) => {
  const user = await requireSession();
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  let raw: unknown = body;
  if (body && typeof body.url === "string") {
    const board = parseBoardUrl(body.url);
    if (!board) {
      return jsonError(422, "Validation failed", {
        url: "Paste a Greenhouse, Lever or Ashby job board link (e.g. https://jobs.lever.co/acme)",
      });
    }
    raw = { ...board, company: typeof body.company === "string" ? body.company : "" };
  }

  const parsed = sourceInputSchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);
  const input = { ...parsed.data, company: parsed.data.company || titleCase(parsed.data.boardToken) };

  let jobs;
  try {
    jobs = await fetchBoard(input.ats, input.boardToken);
  } catch (error) {
    if (error instanceof BoardNotFoundError) return jsonError(422, error.message);
    return jsonError(502, `Could not reach that job board: ${error instanceof Error ? error.message : error}`);
  }

  const source = await addSource(user.id, input);
  if (!source) return jsonError(409, "You are already watching this board");
  await upsertJobs(input.ats, input.boardToken, input.company, jobs);

  return NextResponse.json({ ...source, jobCount: jobs.length }, { status: 201 });
});
