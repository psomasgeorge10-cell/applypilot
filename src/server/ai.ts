/**
 * Everything the app asks Claude to do.
 *
 * The rest of the server depends on the `AiService` interface, not on the SDK,
 * so tests swap in a deterministic fake and the pipeline never needs a network.
 *
 * Every call uses structured outputs (`output_config.format` with a Zod
 * schema), so responses arrive as validated objects instead of text to parse.
 * Server-side refusal fallbacks are enabled, so a request the primary model
 * declines is retried on a fallback model inside the same call.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { CandidateProfile, Preferences, ScreeningAnswers } from "@/lib/types";

export interface JobForAi {
  company: string;
  title: string;
  location: string;
  remote: boolean;
  description: string;
}

export interface MatchResult {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

/** A form field the submitter found and could not fill from stored data. */
export interface FormField {
  key: string;
  label: string;
  kind: "text" | "textarea" | "select" | "radio" | "checkbox";
  options: string[];
  required: boolean;
}

export interface FieldAnswer {
  key: string;
  /** null when the answer is not supported by the candidate's own data. */
  answer: string | null;
}

export type ResumeInput =
  | { kind: "pdf"; base64: string }
  | { kind: "text"; text: string };

export interface AiService {
  parseResume(input: ResumeInput): Promise<CandidateProfile>;
  scoreJob(profile: CandidateProfile, preferences: Preferences, job: JobForAi): Promise<MatchResult>;
  writeCoverLetter(
    profile: CandidateProfile,
    preferences: Preferences,
    job: JobForAi,
    match: MatchResult,
  ): Promise<string>;
  answerFields(
    profile: CandidateProfile,
    answers: ScreeningAnswers,
    job: JobForAi,
    coverLetter: string,
    fields: FormField[],
  ): Promise<FieldAnswer[]>;
}

export class AiError extends Error {}

/* -------------------------------------------------------------------------- */
/* Output schemas                                                              */
/* -------------------------------------------------------------------------- */

// Bounds are enforced after parsing (see clamp) rather than in the schema, so
// the schema stays within what structured outputs accept.
const profileOutput = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  headline: z.string(),
  summary: z.string(),
  yearsExperience: z.number(),
  skills: z.array(z.string()),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      start: z.string(),
      end: z.string(),
      highlights: z.array(z.string()),
    }),
  ),
  education: z.array(z.object({ school: z.string(), degree: z.string(), year: z.string() })),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
});

const matchOutput = z.object({
  score: z.number(),
  summary: z.string(),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
});

const coverLetterOutput = z.object({ coverLetter: z.string() });

const fieldAnswersOutput = z.object({
  answers: z.array(z.object({ key: z.string(), answer: z.string().nullable() })),
});

/* -------------------------------------------------------------------------- */
/* Prompts                                                                     */
/* -------------------------------------------------------------------------- */

const PARSE_SYSTEM = `You extract a structured candidate profile from a resume.
Copy facts exactly as written; never invent employers, dates, degrees, or contact details.
Use an empty string or empty list for anything the resume does not state.
yearsExperience is total professional experience in years, estimated from the dates listed.
highlights are the resume's own achievement bullets, lightly tidied, most impressive first (at most 6 per role).`;

const SCORE_SYSTEM = `You are a recruiter screening job postings on behalf of one candidate.
Score how well each posting fits the candidate from 0 to 100, considering, in order:
hard requirements the candidate clearly lacks (years, must-have skills, licenses, location or work authorization),
then role and seniority fit, then skills overlap, then the candidate's stated preferences.
Calibrate: 85+ means a strong, credible application; 60-84 means worth applying with a tailored letter; below 60 means a poor use of the candidate's time.
summary is one or two plain sentences addressed to the candidate. strengths and gaps are short phrases (at most 4 each).`;

const LETTER_SYSTEM = `You write concise, specific cover letters for a job seeker.
Rules:
- 180 to 280 words, three or four short paragraphs, first person, plain professional tone.
- Open with why this role at this company, not with "I am writing to apply".
- Connect two or three concrete achievements from the candidate's profile to the posting's needs.
- Use only facts present in the candidate profile. Never invent metrics, employers, or skills.
- No placeholders, no bracketed text, no date or address block. End with the candidate's name.`;

const FIELDS_SYSTEM = `You fill in job application form fields on behalf of a candidate.
For each field, return an answer or null.
- Factual questions about the candidate (authorization, sponsorship, salary, location, years with a tool, demographics, start date, anything legal):
  answer ONLY if the candidate profile or saved answers state it. Otherwise return null. Never guess these.
- Demographic or voluntary self-identification questions: choose the "decline to answer" style option if one exists, else null.
- Motivation or open-ended questions ("Why do you want to work here?"): write 2-4 sentences grounded in the profile and posting.
- For select and radio fields the answer must be exactly one of the listed options, or null.
- For checkbox fields answer "yes" or "no"; answer "yes" to consent/acknowledgement boxes only if they concern privacy policy or data processing for this application.`;

function profileBlock(profile: CandidateProfile, preferences?: Preferences): string {
  const parts = [`<candidate_profile>\n${JSON.stringify(profile, null, 2)}\n</candidate_profile>`];
  if (preferences) {
    parts.push(`<candidate_preferences>\n${JSON.stringify(preferences, null, 2)}\n</candidate_preferences>`);
  }
  return parts.join("\n\n");
}

function jobBlock(job: JobForAi): string {
  return `<job_posting>
Company: ${job.company}
Title: ${job.title}
Location: ${job.location || "not stated"}${job.remote ? " (remote)" : ""}

${job.description}
</job_posting>`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));
}

/* -------------------------------------------------------------------------- */
/* Claude-backed implementation                                                */
/* -------------------------------------------------------------------------- */

type Effort = "low" | "medium" | "high";

export function createClaudeService(client = new Anthropic()): AiService {
  const model = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5";

  async function structured<T>(options: {
    schema: z.ZodType<T>;
    system: string;
    /** Stable context (the candidate) - cached across the many calls of one pipeline run. */
    context?: string;
    content: Anthropic.Beta.BetaContentBlockParam[];
    effort: Effort;
    maxTokens?: number;
  }): Promise<T> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: options.system }];
    if (options.context) {
      system.push({ type: "text", text: options.context, cache_control: { type: "ephemeral" } });
    }

    const response = await client.beta.messages.parse({
      model,
      max_tokens: options.maxTokens ?? 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: options.effort, format: betaZodOutputFormat(options.schema) },
      system,
      messages: [{ role: "user", content: options.content }],
    });

    if (response.stop_reason === "refusal") {
      throw new AiError("The model declined this request");
    }
    if (response.stop_reason === "max_tokens") {
      throw new AiError("The model ran out of output space");
    }
    if (!response.parsed_output) {
      throw new AiError("The model returned an unexpected response");
    }
    return response.parsed_output as T;
  }

  return {
    async parseResume(input) {
      const resume: Anthropic.Beta.BetaContentBlockParam =
        input.kind === "pdf"
          ? {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: input.base64 },
            }
          : { type: "text", text: `<resume>\n${input.text}\n</resume>` };

      const parsed = await structured({
        schema: profileOutput,
        system: PARSE_SYSTEM,
        content: [resume, { type: "text", text: "Extract the candidate profile from this resume." }],
        effort: "medium",
      });
      return {
        ...parsed,
        yearsExperience: clamp(parsed.yearsExperience, 0, 70),
        skills: parsed.skills.slice(0, 50),
        experience: parsed.experience.slice(0, 30),
        education: parsed.education.slice(0, 10),
        links: parsed.links.slice(0, 10),
      };
    },

    async scoreJob(profile, preferences, job) {
      const parsed = await structured({
        schema: matchOutput,
        system: SCORE_SYSTEM,
        context: profileBlock(profile, preferences),
        content: [{ type: "text", text: `${jobBlock(job)}\n\nScore this posting for the candidate.` }],
        // High volume and a judgement the model makes easily: low effort keeps
        // a run over a few hundred postings fast and cheap.
        effort: "low",
      });
      return {
        score: clamp(parsed.score, 0, 100),
        summary: parsed.summary.trim(),
        strengths: parsed.strengths.slice(0, 4),
        gaps: parsed.gaps.slice(0, 4),
      };
    },

    async writeCoverLetter(profile, preferences, job, match) {
      const parsed = await structured({
        schema: coverLetterOutput,
        system: LETTER_SYSTEM,
        context: profileBlock(profile, preferences),
        content: [
          {
            type: "text",
            text: `${jobBlock(job)}

<fit_assessment>
Strengths: ${match.strengths.join("; ") || "n/a"}
Gaps: ${match.gaps.join("; ") || "n/a"}
</fit_assessment>

Write the cover letter for this posting.`,
          },
        ],
        effort: "high",
      });
      return parsed.coverLetter.trim();
    },

    async answerFields(profile, answers, job, coverLetter, fields) {
      if (fields.length === 0) return [];
      const parsed = await structured({
        schema: fieldAnswersOutput,
        system: FIELDS_SYSTEM,
        context: `${profileBlock(profile)}\n\n<saved_answers>\n${JSON.stringify(answers, null, 2)}\n</saved_answers>`,
        content: [
          {
            type: "text",
            text: `${jobBlock(job)}

<cover_letter>
${coverLetter}
</cover_letter>

<form_fields>
${JSON.stringify(fields, null, 2)}
</form_fields>

Return one entry per form field, using its key.`,
          },
        ],
        effort: "medium",
      });

      // Keep only answers for fields we asked about, and only legal options.
      const byKey = new Map(fields.map((field) => [field.key, field]));
      return parsed.answers.flatMap((entry) => {
        const field = byKey.get(entry.key);
        if (!field) return [];
        const answer = entry.answer?.trim() || null;
        if (answer && field.options.length > 0 && !field.options.includes(answer)) {
          return [{ key: entry.key, answer: null }];
        }
        return [{ key: entry.key, answer }];
      });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                      */
/* -------------------------------------------------------------------------- */

let override: AiService | null = null;
let instance: AiService | null = null;

/** Tests call this to run the pipeline against a fake. */
export function setAiService(service: AiService | null): void {
  override = service;
}

export function aiConfigured(): boolean {
  return Boolean(override || process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function getAi(): AiService {
  if (override) return override;
  if (!aiConfigured()) {
    throw new AiError("ANTHROPIC_API_KEY is not set - add it to .env.local to enable AI features");
  }
  instance ??= createClaudeService();
  return instance;
}
