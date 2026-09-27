/**
 * Data access. Every query is parameterised, and every function that touches a
 * user's data takes their id, so one user can never read another's rows.
 */

import { getDb, type Database } from "./db";
import { hashPassword } from "./password";
import { answersSchema, candidateProfileSchema, preferencesSchema } from "@/lib/validation";
import {
  AUTO_APPLY_ATS,
  type Application,
  type ApplicationStatus,
  type ApplicationView,
  type AtsKind,
  type CandidateProfile,
  type DashboardStats,
  type JobSource,
  type PendingQuestion,
  type Preferences,
  type ProfileSettings,
  type ProfileView,
  type ScreeningAnswers,
  type SessionUser,
} from "@/lib/types";
import type { NormalizedJob } from "./ats";
import type { MatchResult } from "./ai";

async function db(given?: Database): Promise<Database> {
  return given ?? getDb();
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export class EmailTakenError extends Error {}

export async function createUser(
  input: { name: string; email: string; password: string },
  given?: Database,
): Promise<SessionUser> {
  const conn = await db(given);
  const passwordHash = await hashPassword(input.password);
  const { rows } = await conn.query<SessionUser>(
    `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, name, email`,
    [input.name, input.email.toLowerCase(), passwordHash],
  );
  if (!rows[0]) throw new EmailTakenError();
  await conn.query(`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [rows[0].id]);
  return rows[0];
}

export const DEMO_EMAIL = "demo@example.com";

/** True when `npm run db:setup` has created the demo account on this database. */
export async function demoAccountExists(given?: Database): Promise<boolean> {
  const conn = await db(given);
  const { rows } = await conn.query<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [DEMO_EMAIL]);
  return rows.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

interface ProfileRow {
  resume_filename: string | null;
  has_resume: boolean;
  resume_text: string;
  profile: unknown;
  preferences: unknown;
  answers: unknown;
  auto_apply: boolean;
  auto_apply_min_score: number;
  review_min_score: number;
  daily_apply_limit: number;
}

/** Everything the pipeline needs about a user, with stored JSON re-validated. */
export interface UserContext {
  userId: number;
  profile: CandidateProfile | null;
  preferences: Preferences;
  answers: ScreeningAnswers;
  settings: ProfileSettings;
}

function toContext(userId: number, row: ProfileRow | undefined): UserContext {
  const profile = candidateProfileSchema.safeParse(row?.profile);
  return {
    userId,
    profile: profile.success ? profile.data : null,
    // Parsing through the schemas fills defaults for fields added after the
    // row was written, so older rows never crash newer code.
    preferences: preferencesSchema.parse(row?.preferences ?? {}),
    answers: answersSchema.parse(row?.answers ?? {}),
    settings: {
      autoApply: row?.auto_apply ?? false,
      autoApplyMinScore: row?.auto_apply_min_score ?? 85,
      reviewMinScore: row?.review_min_score ?? 60,
      dailyApplyLimit: row?.daily_apply_limit ?? 10,
    },
  };
}

async function profileRow(conn: Database, userId: number): Promise<ProfileRow | undefined> {
  const { rows } = await conn.query<ProfileRow>(
    `SELECT resume_filename, resume_file IS NOT NULL AS has_resume, resume_text, profile,
            preferences, answers, auto_apply, auto_apply_min_score, review_min_score,
            daily_apply_limit
       FROM profiles WHERE user_id = $1`,
    [userId],
  );
  return rows[0];
}

export async function getUserContext(userId: number, given?: Database): Promise<UserContext> {
  const conn = await db(given);
  return toContext(userId, await profileRow(conn, userId));
}

export async function getProfileView(userId: number, given?: Database): Promise<ProfileView> {
  const conn = await db(given);
  const row = await profileRow(conn, userId);
  const context = toContext(userId, row);
  return {
    hasResume: Boolean(row?.has_resume || row?.resume_text),
    resumeFilename: row?.resume_filename ?? null,
    profile: context.profile,
    preferences: context.preferences,
    answers: context.answers,
    settings: context.settings,
  };
}

export async function getResumeFile(
  userId: number,
  given?: Database,
): Promise<{ data: Uint8Array; filename: string; mime: string } | null> {
  const conn = await db(given);
  const { rows } = await conn.query<{ resume_file: Uint8Array | null; resume_filename: string; resume_mime: string }>(
    `SELECT resume_file, resume_filename, resume_mime FROM profiles WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row?.resume_file) return null;
  return { data: new Uint8Array(row.resume_file), filename: row.resume_filename, mime: row.resume_mime };
}

export async function saveResume(
  userId: number,
  resume: {
    file: Uint8Array | null;
    filename: string | null;
    mime: string | null;
    text: string;
    profile: CandidateProfile;
  },
  given?: Database,
): Promise<void> {
  const conn = await db(given);
  await conn.query(
    `INSERT INTO profiles (user_id, resume_file, resume_filename, resume_mime, resume_text, profile, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (user_id) DO UPDATE SET
       resume_file = EXCLUDED.resume_file,
       resume_filename = EXCLUDED.resume_filename,
       resume_mime = EXCLUDED.resume_mime,
       resume_text = EXCLUDED.resume_text,
       profile = EXCLUDED.profile,
       updated_at = now()`,
    [userId, resume.file, resume.filename, resume.mime, resume.text, JSON.stringify(resume.profile)],
  );
}

export async function updateProfile(
  userId: number,
  patch: {
    profile?: CandidateProfile;
    preferences?: Preferences;
    answers?: ScreeningAnswers;
    settings?: ProfileSettings;
  },
  given?: Database,
): Promise<void> {
  const conn = await db(given);
  const sets: string[] = [];
  const params: unknown[] = [userId];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (patch.profile) add("profile", JSON.stringify(patch.profile), "::jsonb");
  if (patch.preferences) add("preferences", JSON.stringify(patch.preferences), "::jsonb");
  if (patch.answers) add("answers", JSON.stringify(patch.answers), "::jsonb");
  if (patch.settings) {
    add("auto_apply", patch.settings.autoApply);
    add("auto_apply_min_score", patch.settings.autoApplyMinScore);
    add("review_min_score", patch.settings.reviewMinScore);
    add("daily_apply_limit", patch.settings.dailyApplyLimit);
  }
  if (sets.length === 0) return;

  await conn.query(`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  await conn.query(`UPDATE profiles SET ${sets.join(", ")}, updated_at = now() WHERE user_id = $1`, params);
}

/** Users whose pipeline the background worker should run. */
export async function listPipelineUsers(given?: Database): Promise<number[]> {
  const conn = await db(given);
  const { rows } = await conn.query<{ user_id: number }>(
    `SELECT p.user_id FROM profiles p
      WHERE p.profile <> '{}'::jsonb
        AND EXISTS (SELECT 1 FROM job_sources s WHERE s.user_id = p.user_id)`,
  );
  return rows.map((row) => row.user_id);
}

/* -------------------------------------------------------------------------- */
/* Job sources                                                                 */
/* -------------------------------------------------------------------------- */

interface SourceRow {
  id: number;
  ats: AtsKind;
  board_token: string;
  company: string;
  last_synced_at: Date | string | null;
  last_error: string | null;
  job_count: number;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSource(row: SourceRow): JobSource {
  return {
    id: row.id,
    ats: row.ats,
    boardToken: row.board_token,
    company: row.company,
    lastSyncedAt: iso(row.last_synced_at),
    lastError: row.last_error,
    jobCount: Number(row.job_count ?? 0),
  };
}

const SOURCE_SELECT = `
  SELECT s.id, s.ats, s.board_token, s.company, s.last_synced_at, s.last_error,
         (SELECT count(*)::int FROM jobs j WHERE j.ats = s.ats AND j.board_token = s.board_token) AS job_count
    FROM job_sources s`;

export async function listSources(userId: number, given?: Database): Promise<JobSource[]> {
  const conn = await db(given);
  const { rows } = await conn.query<SourceRow>(
    `${SOURCE_SELECT} WHERE s.user_id = $1 ORDER BY lower(s.company)`,
    [userId],
  );
  return rows.map(toSource);
}

export async function addSource(
  userId: number,
  input: { ats: AtsKind; boardToken: string; company: string },
  given?: Database,
): Promise<JobSource | null> {
  const conn = await db(given);
  const { rows } = await conn.query<{ id: number }>(
    `INSERT INTO job_sources (user_id, ats, board_token, company) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, ats, board_token) DO NOTHING RETURNING id`,
    [userId, input.ats, input.boardToken, input.company],
  );
  if (!rows[0]) return null;
  const created = await conn.query<SourceRow>(`${SOURCE_SELECT} WHERE s.id = $1`, [rows[0].id]);
  return toSource(created.rows[0]);
}

export async function deleteSource(userId: number, id: number, given?: Database): Promise<boolean> {
  const conn = await db(given);
  const { rowCount } = await conn.query(`DELETE FROM job_sources WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rowCount > 0;
}

export async function recordSourceSync(
  sourceId: number,
  error: string | null,
  given?: Database,
): Promise<void> {
  const conn = await db(given);
  await conn.query(
    `UPDATE job_sources SET last_synced_at = CASE WHEN $2::text IS NULL THEN now() ELSE last_synced_at END,
            last_error = $2 WHERE id = $1`,
    [sourceId, error],
  );
}

/* -------------------------------------------------------------------------- */
/* Jobs                                                                        */
/* -------------------------------------------------------------------------- */

/** Inserts or refreshes a board's postings. Returns how many were new. */
export async function upsertJobs(
  ats: AtsKind,
  boardToken: string,
  company: string,
  jobs: NormalizedJob[],
  given?: Database,
): Promise<number> {
  const conn = await db(given);
  let created = 0;
  for (const job of jobs) {
    const { rows } = await conn.query<{ inserted: boolean }>(
      `INSERT INTO jobs (ats, board_token, external_id, company, title, location, remote, url,
                         apply_url, description, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (ats, board_token, external_id) DO UPDATE SET
         title = EXCLUDED.title, location = EXCLUDED.location, remote = EXCLUDED.remote,
         url = EXCLUDED.url, apply_url = EXCLUDED.apply_url, description = EXCLUDED.description,
         company = EXCLUDED.company, last_seen_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [
        ats,
        boardToken,
        job.externalId,
        company,
        job.title,
        job.location,
        job.remote,
        job.url,
        job.applyUrl,
        job.description,
        job.postedAt,
      ],
    );
    if (rows[0]?.inserted) created += 1;
  }
  return created;
}

export interface JobRow {
  id: number;
  ats: AtsKind;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  apply_url: string;
  description: string;
  posted_at: Date | string | null;
}

/**
 * Postings on the user's boards that have not been evaluated for them yet,
 * newest first. Postings not seen on their board for two days are treated as
 * closed and ignored.
 */
export async function unscoredJobs(userId: number, limit: number, given?: Database): Promise<JobRow[]> {
  const conn = await db(given);
  const { rows } = await conn.query<JobRow>(
    `SELECT j.id, j.ats, j.company, j.title, j.location, j.remote, j.url, j.apply_url,
            j.description, j.posted_at
       FROM jobs j
       JOIN job_sources s ON s.ats = j.ats AND s.board_token = j.board_token AND s.user_id = $1
      WHERE j.last_seen_at > now() - interval '2 days'
        AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.user_id = $1 AND a.job_id = j.id)
      ORDER BY j.posted_at DESC NULLS LAST, j.id DESC
      LIMIT $2`,
    [userId, limit],
  );
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Applications                                                                */
/* -------------------------------------------------------------------------- */

export async function createApplication(
  input: {
    userId: number;
    jobId: number;
    status: ApplicationStatus;
    match: MatchResult;
    coverLetter?: string;
    autoApproved?: boolean;
  },
  given?: Database,
): Promise<number> {
  const conn = await db(given);
  const { rows } = await conn.query<{ id: number }>(
    `INSERT INTO applications (user_id, job_id, status, score, match_summary, strengths, gaps,
                               cover_letter, auto_approved)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
     ON CONFLICT (user_id, job_id) DO UPDATE SET updated_at = applications.updated_at
     RETURNING id`,
    [
      input.userId,
      input.jobId,
      input.status,
      input.match.score,
      input.match.summary,
      JSON.stringify(input.match.strengths),
      JSON.stringify(input.match.gaps),
      input.coverLetter ?? "",
      input.autoApproved ?? false,
    ],
  );
  return rows[0].id;
}

interface ApplicationRow {
  id: number;
  status: ApplicationStatus;
  score: number;
  match_summary: string;
  strengths: string[];
  gaps: string[];
  cover_letter: string;
  auto_approved: boolean;
  pending_questions: PendingQuestion[];
  extra_answers: Record<string, string>;
  last_error: string | null;
  applied_at: Date | string | null;
  created_at: Date | string;
  job_id: number;
  ats: AtsKind;
  company: string;
  title: string;
  location: string;
  remote: boolean;
  url: string;
  apply_url: string;
  description: string;
  posted_at: Date | string | null;
}

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    status: row.status,
    score: row.score,
    matchSummary: row.match_summary,
    strengths: row.strengths ?? [],
    gaps: row.gaps ?? [],
    coverLetter: row.cover_letter,
    autoApproved: row.auto_approved,
    canAutoApply: AUTO_APPLY_ATS.includes(row.ats),
    pendingQuestions: row.pending_questions ?? [],
    extraAnswers: row.extra_answers ?? {},
    lastError: row.last_error,
    appliedAt: iso(row.applied_at),
    createdAt: iso(row.created_at)!,
    job: {
      id: row.job_id,
      ats: row.ats,
      company: row.company,
      title: row.title,
      location: row.location,
      remote: row.remote,
      url: row.url,
      applyUrl: row.apply_url,
      description: row.description,
      postedAt: iso(row.posted_at),
    },
  };
}

const APPLICATION_SELECT = `
  SELECT a.id, a.status, a.score, a.match_summary, a.strengths, a.gaps, a.cover_letter,
         a.auto_approved, a.pending_questions, a.extra_answers, a.last_error, a.applied_at,
         a.created_at, j.id AS job_id, j.ats, j.company, j.title, j.location, j.remote, j.url,
         j.apply_url, j.description, j.posted_at
    FROM applications a
    JOIN jobs j ON j.id = a.job_id`;

const VIEW_FILTERS: Record<ApplicationView, { statuses: ApplicationStatus[] | null; order: string }> = {
  review: { statuses: ["suggested", "needs_input"], order: "a.status DESC, a.score DESC, a.id DESC" },
  active: { statuses: ["approved", "applying", "failed"], order: "a.updated_at DESC" },
  done: {
    statuses: ["applied", "interview", "rejected", "offer"],
    order: "a.applied_at DESC NULLS LAST, a.updated_at DESC",
  },
  all: { statuses: null, order: "a.updated_at DESC" },
};

export async function listApplications(
  userId: number,
  view: ApplicationView,
  given?: Database,
): Promise<Application[]> {
  const conn = await db(given);
  const filter = VIEW_FILTERS[view];
  const params: unknown[] = [userId];
  let where = "a.user_id = $1";
  if (filter.statuses) {
    // Passed as one comma-separated string: PGlite and node-postgres serialise
    // JS arrays differently, and a plain string means the same to both.
    params.push(filter.statuses.join(","));
    where += ` AND a.status = ANY(string_to_array($2, ',')::application_status[])`;
  }
  const { rows } = await conn.query<ApplicationRow>(
    `${APPLICATION_SELECT} WHERE ${where} ORDER BY ${filter.order} LIMIT 200`,
    params,
  );
  return rows.map(toApplication);
}

export async function getApplication(
  userId: number,
  id: number,
  given?: Database,
): Promise<Application | null> {
  const conn = await db(given);
  const { rows } = await conn.query<ApplicationRow>(
    `${APPLICATION_SELECT} WHERE a.user_id = $1 AND a.id = $2`,
    [userId, id],
  );
  return rows[0] ? toApplication(rows[0]) : null;
}

export async function updateApplication(
  userId: number,
  id: number,
  patch: {
    status?: ApplicationStatus;
    coverLetter?: string;
    extraAnswers?: Record<string, string>;
    pendingQuestions?: PendingQuestion[];
    lastError?: string | null;
    appliedAt?: "now";
  },
  given?: Database,
): Promise<Application | null> {
  const conn = await db(given);
  const sets: string[] = [];
  const params: unknown[] = [userId, id];
  const add = (column: string, value: unknown, cast = "") => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };

  if (patch.status) add("status", patch.status, "::application_status");
  if (patch.coverLetter !== undefined) add("cover_letter", patch.coverLetter);
  if (patch.extraAnswers) {
    // Merged, so answering one question does not erase the others.
    params.push(JSON.stringify(patch.extraAnswers));
    sets.push(`extra_answers = extra_answers || $${params.length}::jsonb`);
  }
  if (patch.pendingQuestions) add("pending_questions", JSON.stringify(patch.pendingQuestions), "::jsonb");
  if (patch.lastError !== undefined) add("last_error", patch.lastError);
  if (patch.appliedAt === "now") sets.push("applied_at = now()");

  if (sets.length > 0) {
    const { rowCount } = await conn.query(
      `UPDATE applications SET ${sets.join(", ")}, updated_at = now() WHERE user_id = $1 AND id = $2`,
      params,
    );
    if (rowCount === 0) return null;
  }
  return getApplication(userId, id, conn);
}

/**
 * Atomically moves approved applications to `applying` and returns them, so
 * two overlapping runs can never submit the same application twice.
 */
export async function claimApproved(userId: number, limit: number, given?: Database): Promise<number[]> {
  if (limit <= 0) return [];
  const conn = await db(given);
  const { rows } = await conn.query<{ id: number }>(
    `UPDATE applications SET status = 'applying', updated_at = now()
      WHERE id IN (
        SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.user_id = $1 AND a.status = 'approved' AND j.ats = ANY(string_to_array($3, ','))
         ORDER BY a.score DESC LIMIT $2
      )
      RETURNING id`,
    [userId, limit, AUTO_APPLY_ATS.join(",")],
  );
  return rows.map((row) => row.id);
}

export async function countAppliedToday(userId: number, given?: Database): Promise<number> {
  const conn = await db(given);
  const { rows } = await conn.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM applications
      WHERE user_id = $1 AND applied_at >= date_trunc('day', now())`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getStats(userId: number, given?: Database): Promise<DashboardStats> {
  const conn = await db(given);
  const { rows } = await conn.query<Record<keyof DashboardStats, number>>(
    `SELECT
       count(*) FILTER (WHERE status = 'suggested')::int AS "toReview",
       count(*) FILTER (WHERE status IN ('approved', 'applying'))::int AS queued,
       count(*) FILTER (WHERE status = 'needs_input')::int AS "needsInput",
       count(*) FILTER (WHERE status IN ('applied', 'interview', 'rejected', 'offer'))::int AS "appliedTotal",
       count(*) FILTER (WHERE applied_at >= date_trunc('day', now()))::int AS "appliedToday",
       count(*) FILTER (WHERE status IN ('interview', 'offer'))::int AS interviews
     FROM applications WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  return {
    toReview: Number(row?.toReview ?? 0),
    queued: Number(row?.queued ?? 0),
    needsInput: Number(row?.needsInput ?? 0),
    appliedTotal: Number(row?.appliedTotal ?? 0),
    appliedToday: Number(row?.appliedToday ?? 0),
    interviews: Number(row?.interviews ?? 0),
  };
}
