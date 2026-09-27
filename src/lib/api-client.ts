/**
 * Typed browser client for the REST API.
 *
 * Every component talks to the backend through this module, so error handling
 * is defined in exactly one place.
 */

import type {
  Application,
  ApplicationView,
  DashboardStats,
  JobSource,
  PipelineReport,
  ProfileView,
  SessionUser,
} from "./types";
import type { ApplicationPatch, ProfilePatch } from "./validation";

/** An HTTP error carrying the API's `{ error, details }` payload. */
export class ApiError extends Error {
  readonly status: number;
  readonly details: Record<string, string>;

  constructor(status: number, message: string, details: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    const json = typeof init?.body === "string";
    response = await fetch(path, {
      ...init,
      headers: json ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }

  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error ?? `Request failed (${response.status})`;
    const details = (payload as { details?: Record<string, string> } | null)?.details ?? {};
    // A validation error's first field message is usually the useful part.
    const first = Object.values(details)[0];
    throw new ApiError(response.status, message === "Validation failed" && first ? first : message, details);
  }
  return payload as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const api = {
  login: (email: string, password: string) =>
    request<SessionUser>("/api/auth/login", json("POST", { email, password })),
  signup: (name: string, email: string, password: string) =>
    request<SessionUser>("/api/auth/signup", json("POST", { name, email, password })),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  profile: () => request<ProfileView>("/api/profile"),
  updateProfile: (patch: ProfilePatch) => request<ProfileView>("/api/profile", json("PATCH", patch)),
  uploadResume(file: File) {
    const form = new FormData();
    form.set("file", file);
    return request<ProfileView>("/api/profile/resume", { method: "POST", body: form });
  },

  sources: () => request<JobSource[]>("/api/sources"),
  addSourceByUrl: (url: string, company: string) =>
    request<JobSource>("/api/sources", json("POST", { url, company })),
  deleteSource: (id: number) => request<void>(`/api/sources/${id}`, { method: "DELETE" }),

  stats: (signal?: AbortSignal) => request<DashboardStats>("/api/stats", { signal }),
  applications: (view: ApplicationView, signal?: AbortSignal) =>
    request<Application[]>(`/api/applications?view=${view}`, { signal }),
  updateApplication: (id: number, patch: ApplicationPatch) =>
    request<Application>(`/api/applications/${id}`, json("PATCH", patch)),
  apply: (id: number) => request<Application>(`/api/applications/${id}/apply`, { method: "POST" }),
  regenerateCoverLetter: (id: number) =>
    request<Application>(`/api/applications/${id}/cover-letter`, { method: "POST" }),

  runPipeline: () => request<PipelineReport>("/api/pipeline/run", { method: "POST" }),
};
