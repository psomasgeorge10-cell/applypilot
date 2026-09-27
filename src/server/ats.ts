/**
 * Job discovery from public applicant-tracking-system job boards.
 *
 * Greenhouse, Lever and Ashby each publish every company's open roles through
 * an unauthenticated, documented JSON endpoint - the same data their hosted
 * career pages render. Using those endpoints (rather than scraping LinkedIn or
 * Indeed, whose terms forbid it) keeps discovery reliable and above board.
 *
 * Each adapter is split into a fetch and a pure `normalize*` function so the
 * mapping can be tested against recorded payloads without the network.
 */

import type { AtsKind } from "@/lib/types";

export interface NormalizedJob {
  externalId: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  applyUrl: string;
  description: string;
  postedAt: string | null;
}

const FETCH_TIMEOUT_MS = 20_000;
/** Descriptions are fed to the model; anything past this is boilerplate. */
const MAX_DESCRIPTION_CHARS = 20_000;

/* -------------------------------------------------------------------------- */
/* HTML to text                                                                */
/* -------------------------------------------------------------------------- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
  mdash: "-",
  ndash: "-",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: "...",
  bull: "-",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+[0-9]*);/gi, (match, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return match;
  });
}

/** Flattens posting HTML into readable plain text, keeping paragraph and list structure. */
export function htmlToText(html: string): string {
  // Greenhouse double-encodes: the HTML itself arrives entity-escaped.
  const source = /&lt;[a-z/]/i.test(html) ? decodeEntities(html) : html;
  const text = source
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|ul|ol|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
}

function looksRemote(...values: (string | null | undefined)[]): boolean {
  return values.some((value) => /\bremote\b|anywhere|distributed/i.test(value ?? ""));
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Greenhouse                                                                  */
/* -------------------------------------------------------------------------- */

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  first_published?: string;
  location?: { name?: string };
  content?: string;
}

export function normalizeGreenhouse(boardToken: string, payload: unknown): NormalizedJob[] {
  const jobs = (payload as { jobs?: GreenhouseJob[] })?.jobs ?? [];
  return jobs.map((job) => {
    const location = job.location?.name ?? "";
    const description = htmlToText(job.content ?? "");
    return {
      externalId: String(job.id),
      title: job.title.trim(),
      location,
      remote: looksRemote(location, job.title),
      url: job.absolute_url,
      // The embeddable form is always hosted by Greenhouse, even when the
      // company's own career site wraps it in an iframe - so the submitter
      // gets the same markup for every company.
      applyUrl: `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(boardToken)}&token=${job.id}`,
      description,
      postedAt: isoOrNull(job.first_published ?? job.updated_at),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Lever                                                                       */
/* -------------------------------------------------------------------------- */

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

export function normalizeLever(_boardToken: string, payload: unknown): NormalizedJob[] {
  const postings = Array.isArray(payload) ? (payload as LeverPosting[]) : [];
  return postings.map((posting) => {
    const location =
      posting.categories?.allLocations?.join(" / ") || posting.categories?.location || "";
    const sections = [
      posting.descriptionPlain ?? htmlToText(posting.description ?? ""),
      ...(posting.lists ?? []).map((list) => `${list.text}\n${htmlToText(list.content)}`),
      posting.additionalPlain ?? "",
    ];
    return {
      externalId: posting.id,
      title: posting.text.trim(),
      location,
      remote: posting.workplaceType === "remote" || looksRemote(location),
      url: posting.hostedUrl,
      applyUrl: posting.applyUrl ?? `${posting.hostedUrl}/apply`,
      description: sections.filter(Boolean).join("\n\n").trim().slice(0, MAX_DESCRIPTION_CHARS),
      postedAt: isoOrNull(posting.createdAt),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Ashby                                                                       */
/* -------------------------------------------------------------------------- */

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  workplaceType?: string;
  isListed?: boolean;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
}

export function normalizeAshby(_boardToken: string, payload: unknown): NormalizedJob[] {
  const jobs = (payload as { jobs?: AshbyJob[] })?.jobs ?? [];
  return jobs
    .filter((job) => job.isListed !== false)
    .map((job) => {
      const location = [job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)]
        .filter(Boolean)
        .join(" / ");
      return {
        externalId: job.id,
        title: job.title.trim(),
        location,
        remote: job.isRemote === true || job.workplaceType === "Remote" || looksRemote(location),
        url: job.jobUrl,
        applyUrl: job.applyUrl ?? job.jobUrl,
        description: (job.descriptionPlain ?? htmlToText(job.descriptionHtml ?? ""))
          .trim()
          .slice(0, MAX_DESCRIPTION_CHARS),
        postedAt: isoOrNull(job.publishedAt),
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

const ENDPOINTS: Record<AtsKind, (token: string) => string> = {
  greenhouse: (token) =>
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  lever: (token) => `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
  ashby: (token) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
};

const NORMALIZERS: Record<AtsKind, (token: string, payload: unknown) => NormalizedJob[]> = {
  greenhouse: normalizeGreenhouse,
  lever: normalizeLever,
  ashby: normalizeAshby,
};

export class BoardNotFoundError extends Error {}

export async function fetchBoard(
  ats: AtsKind,
  boardToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NormalizedJob[]> {
  const response = await fetchImpl(ENDPOINTS[ats](boardToken), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 404) {
    throw new BoardNotFoundError(`No ${ats} job board named "${boardToken}"`);
  }
  if (!response.ok) {
    throw new Error(`${ats} returned HTTP ${response.status} for "${boardToken}"`);
  }
  return NORMALIZERS[ats](boardToken, await response.json());
}

/**
 * Recognises a careers-page URL and returns the board it belongs to, so users
 * can paste a link instead of knowing what a "board token" is.
 */
export function parseBoardUrl(input: string): { ats: AtsKind; boardToken: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host.endsWith("greenhouse.io")) {
    const token = url.searchParams.get("for") ?? segments.find((s) => s !== "embed" && s !== "v1" && s !== "boards");
    return token ? { ats: "greenhouse", boardToken: token.toLowerCase() } : null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co" || host === "api.lever.co") {
    const token = host === "api.lever.co" ? segments[2] : segments[0];
    return token ? { ats: "lever", boardToken: token.toLowerCase() } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    return segments[0] ? { ats: "ashby", boardToken: decodeURIComponent(segments[0]).toLowerCase() } : null;
  }
  return null;
}
