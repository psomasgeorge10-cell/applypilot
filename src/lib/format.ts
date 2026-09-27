/**
 * Presentation helpers. Locale and time zone are pinned so a value renders
 * identically on the server and in the browser.
 */

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", "4 days ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86_400);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  return formatDate(iso);
}

/** `AO` for `Amara Okafor` - the avatar fallback. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

/** Tailwind classes for a match score chip. */
export function scoreTone(score: number): string {
  if (score >= 85) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300";
  if (score >= 70) return "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300";
  if (score >= 55) return "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

/** "a, b, c" <-> ["a", "b", "c"] for comma-separated list inputs. */
export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
