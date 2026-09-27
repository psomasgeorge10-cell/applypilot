-- Schema for ApplyPilot.
--
-- The single source of truth for the database structure. Every statement is
-- idempotent: it is applied on start-up for the embedded PGlite database (see
-- src/server/db.ts) and by `npm run db:migrate` against a real server.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per user: their resume, what the AI extracted from it, what they are
-- looking for, and how much autonomy they grant the pipeline.
CREATE TABLE IF NOT EXISTS profiles (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- The original upload, re-attached to every application that asks for a file.
  resume_file       BYTEA,
  resume_filename   TEXT,
  resume_mime       TEXT,
  resume_text       TEXT NOT NULL DEFAULT '',
  -- Structured candidate profile (CandidateProfile in src/lib/types.ts).
  profile           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Search preferences (Preferences in src/lib/types.ts).
  preferences       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Answers to common screening questions (ScreeningAnswers in src/lib/types.ts).
  answers           JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_apply        BOOLEAN NOT NULL DEFAULT false,
  auto_apply_min_score INTEGER NOT NULL DEFAULT 85 CHECK (auto_apply_min_score BETWEEN 0 AND 100),
  review_min_score  INTEGER NOT NULL DEFAULT 60 CHECK (review_min_score BETWEEN 0 AND 100),
  daily_apply_limit INTEGER NOT NULL DEFAULT 10 CHECK (daily_apply_limit BETWEEN 0 AND 100),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Company job boards a user wants watched.
CREATE TABLE IF NOT EXISTS job_sources (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ats            TEXT NOT NULL CHECK (ats IN ('greenhouse', 'lever', 'ashby')),
  board_token    TEXT NOT NULL,
  company        TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ats, board_token)
);

-- Postings, shared between every user watching the same board.
CREATE TABLE IF NOT EXISTS jobs (
  id            SERIAL PRIMARY KEY,
  ats           TEXT NOT NULL,
  board_token   TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  remote        BOOLEAN NOT NULL DEFAULT false,
  url           TEXT NOT NULL,
  apply_url     TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  posted_at     TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ats, board_token, external_id)
);

DO $$
BEGIN
  CREATE TYPE application_status AS ENUM (
    'suggested',   -- scored and waiting in the review queue
    'approved',    -- the user (or auto-apply) said go; waiting for the submitter
    'applying',    -- the submitter is working on it
    'needs_input', -- the form asked something we could not answer
    'applied',
    'failed',
    'skipped',
    'interview',
    'rejected',
    'offer'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS applications (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id            INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status            application_status NOT NULL DEFAULT 'suggested',
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  match_summary     TEXT NOT NULL DEFAULT '',
  strengths         JSONB NOT NULL DEFAULT '[]'::jsonb,
  gaps              JSONB NOT NULL DEFAULT '[]'::jsonb,
  cover_letter      TEXT NOT NULL DEFAULT '',
  auto_approved     BOOLEAN NOT NULL DEFAULT false,
  -- Required questions the submitter could not answer, for the user to fill in.
  pending_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- One-off answers the user gave for this application's pending questions.
  extra_answers     JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error        TEXT,
  applied_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id)
);

CREATE INDEX IF NOT EXISTS applications_user_status_idx ON applications (user_id, status);
