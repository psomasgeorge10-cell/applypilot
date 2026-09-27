/**
 * Cheap, deterministic pre-filtering against the user's preferences.
 *
 * Runs before any posting reaches the model, so a board with 400 openings of
 * which 12 are plausible costs 12 scoring calls, not 400. It is deliberately
 * lenient - anything it lets through still gets scored - and only rejects on
 * signals that are unambiguous.
 */

import type { Preferences } from "@/lib/types";

export interface FilterableJob {
  title: string;
  location: string;
  remote: boolean;
  description: string;
}

export type FilterResult = { ok: true } | { ok: false; reason: string };

/** Lowercase, alphanumerics only - so "Front-End" and "frontend" compare equal. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((word) => word.length > 1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when enough of a wanted title's words appear in the posting's title.
 * "Frontend Engineer" matches "Senior Front-End Software Engineer".
 */
export function titleMatches(jobTitle: string, wanted: string): boolean {
  const haystack = compact(jobTitle);
  const needed = words(wanted);
  if (needed.length === 0) return false;
  const hits = needed.filter((word) => haystack.includes(word)).length;
  return hits >= Math.ceil(needed.length * 0.6);
}

export function prefilter(job: FilterableJob, preferences: Preferences): FilterResult {
  if (preferences.titles.length > 0 && !preferences.titles.some((title) => titleMatches(job.title, title))) {
    return { ok: false, reason: "Title does not match your target roles" };
  }

  for (const keyword of preferences.excludeKeywords) {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword.trim())}\\b`, "i");
    if (pattern.test(job.title) || pattern.test(job.description)) {
      return { ok: false, reason: `Mentions excluded keyword "${keyword}"` };
    }
  }

  if (preferences.remote === "remote_only" && !job.remote) {
    return { ok: false, reason: "Not a remote role" };
  }

  if (preferences.locations.length > 0 && !job.remote && job.location.trim() !== "") {
    const location = job.location.toLowerCase();
    const inRange = preferences.locations.some((wanted) => location.includes(wanted.toLowerCase().trim()));
    if (!inRange) return { ok: false, reason: `Location "${job.location}" is outside your preferred locations` };
  }

  return { ok: true };
}
