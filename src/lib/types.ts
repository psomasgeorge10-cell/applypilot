/** Shared domain types: what the REST API returns and what the UI renders. */

export interface SessionUser {
  id: number;
  name: string;
  email: string;
}

export const ATS_KINDS = ["greenhouse", "lever", "ashby"] as const;
export type AtsKind = (typeof ATS_KINDS)[number];

export const ATS_LABELS: Record<AtsKind, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
};

/**
 * Boards the browser submitter can fill in end to end. Ashby postings are
 * discovered and scored, but applied to manually: its form is a client-rendered
 * app whose markup changes too often to automate reliably.
 */
export const AUTO_APPLY_ATS: readonly AtsKind[] = ["greenhouse", "lever"];

/** What the AI extracted from the resume. Every field is user-editable. */
export interface CandidateProfile {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  headline: string;
  summary: string;
  yearsExperience: number;
  skills: string[];
  experience: {
    title: string;
    company: string;
    start: string;
    end: string;
    highlights: string[];
  }[];
  education: { school: string; degree: string; year: string }[];
  links: { label: string; url: string }[];
}

export const REMOTE_PREFERENCES = ["any", "remote_only", "onsite_ok"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export interface Preferences {
  /** Job titles to look for, e.g. "Frontend Engineer". Matched loosely. */
  titles: string[];
  /** Locations the user can work in. Empty means anywhere. */
  locations: string[];
  remote: RemotePreference;
  /** Words that disqualify a posting outright, e.g. "clearance", "intern". */
  excludeKeywords: string[];
  /** Minimum base salary, for the AI to weigh when a posting lists one. */
  minSalary: number | null;
  seniority: string;
  /** Free text passed to the matcher: "prefer climate/healthtech, no crypto". */
  notes: string;
}

/**
 * Answers to the questions almost every application form asks. The submitter
 * only ever uses these verbatim - it never invents an answer to a factual
 * question about the candidate.
 */
export interface ScreeningAnswers {
  workAuthorization: string;
  requiresSponsorship: string;
  noticePeriod: string;
  salaryExpectation: string;
  willingToRelocate: string;
  linkedin: string;
  github: string;
  website: string;
  pronouns: string;
  /** Anything else, as free-form label -> answer pairs. */
  custom: { question: string; answer: string }[];
}

export interface ProfileSettings {
  autoApply: boolean;
  autoApplyMinScore: number;
  reviewMinScore: number;
  dailyApplyLimit: number;
}

export interface ProfileView {
  hasResume: boolean;
  resumeFilename: string | null;
  profile: CandidateProfile | null;
  preferences: Preferences;
  answers: ScreeningAnswers;
  settings: ProfileSettings;
}

export interface JobSource {
  id: number;
  ats: AtsKind;
  boardToken: string;
  company: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  jobCount: number;
}

export interface Job {
  id: number;
  ats: AtsKind;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  applyUrl: string;
  description: string;
  postedAt: string | null;
}

export const APPLICATION_STATUSES = [
  "suggested",
  "approved",
  "applying",
  "needs_input",
  "applied",
  "failed",
  "skipped",
  "interview",
  "rejected",
  "offer",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  suggested: "To review",
  approved: "Queued",
  applying: "Applying",
  needs_input: "Needs input",
  applied: "Applied",
  failed: "Failed",
  skipped: "Skipped",
  interview: "Interview",
  rejected: "Rejected",
  offer: "Offer",
};

/** Statuses the user can set by hand from the tracker once a job is applied to. */
export const TRACKING_STATUSES = ["applied", "interview", "rejected", "offer"] as const;

export interface PendingQuestion {
  /** Stable key for the form field, used to send the answer back. */
  key: string;
  label: string;
  /** Options for select/radio fields; empty for free text. */
  options: string[];
}

export interface Application {
  id: number;
  status: ApplicationStatus;
  score: number;
  matchSummary: string;
  strengths: string[];
  gaps: string[];
  coverLetter: string;
  autoApproved: boolean;
  /** True when the submitter can fill this job's form without the user. */
  canAutoApply: boolean;
  pendingQuestions: PendingQuestion[];
  extraAnswers: Record<string, string>;
  lastError: string | null;
  appliedAt: string | null;
  createdAt: string;
  job: Job;
}

export type ApplicationView = "review" | "active" | "done" | "all";

export interface DashboardStats {
  toReview: number;
  queued: number;
  needsInput: number;
  appliedTotal: number;
  appliedToday: number;
  interviews: number;
}

export interface PipelineReport {
  sourcesSynced: number;
  sourceErrors: { company: string; error: string }[];
  newJobs: number;
  filteredOut: number;
  scored: number;
  suggested: number;
  autoApproved: number;
  submitted: number;
  submitFailures: number;
  needsInput: number;
}
