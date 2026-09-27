/**
 * Request validation.
 *
 * Every value that reaches the database is parsed through one of these schemas
 * first, so handlers can trust their inputs and the client gets a predictable
 * `{ error, details }` payload when something is wrong.
 */

import { z } from "zod";
import { APPLICATION_STATUSES, ATS_KINDS, REMOTE_PREFERENCES } from "./types";

const shortText = z.string().trim().max(200);
const stringList = z.array(z.string().trim().min(1).max(120)).max(50);

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
});

export const candidateProfileSchema = z.object({
  fullName: shortText,
  email: shortText,
  phone: shortText,
  location: shortText,
  headline: shortText,
  summary: z.string().trim().max(4000),
  yearsExperience: z.number().min(0).max(70),
  skills: stringList,
  experience: z
    .array(
      z.object({
        title: shortText,
        company: shortText,
        start: shortText,
        end: shortText,
        highlights: z.array(z.string().trim().max(600)).max(20),
      }),
    )
    .max(30),
  education: z.array(z.object({ school: shortText, degree: shortText, year: shortText })).max(10),
  links: z.array(z.object({ label: shortText, url: shortText })).max(10),
});

export const preferencesSchema = z.object({
  titles: stringList.default([]),
  locations: stringList.default([]),
  remote: z.enum(REMOTE_PREFERENCES).default("any"),
  excludeKeywords: stringList.default([]),
  minSalary: z.number().int().min(0).max(10_000_000).nullable().default(null),
  seniority: shortText.default(""),
  notes: z.string().trim().max(2000).default(""),
});

export const answersSchema = z.object({
  workAuthorization: shortText.default(""),
  requiresSponsorship: shortText.default(""),
  noticePeriod: shortText.default(""),
  salaryExpectation: shortText.default(""),
  willingToRelocate: shortText.default(""),
  linkedin: shortText.default(""),
  github: shortText.default(""),
  website: shortText.default(""),
  pronouns: shortText.default(""),
  custom: z
    .array(z.object({ question: z.string().trim().min(1).max(500), answer: z.string().trim().max(2000) }))
    .max(50)
    .default([]),
});

export const settingsSchema = z
  .object({
    autoApply: z.boolean(),
    autoApplyMinScore: z.number().int().min(0).max(100),
    reviewMinScore: z.number().int().min(0).max(100),
    dailyApplyLimit: z.number().int().min(0).max(100),
  })
  .refine((value) => value.autoApplyMinScore >= value.reviewMinScore, {
    message: "Auto-apply threshold must be at least the review threshold",
    path: ["autoApplyMinScore"],
  });

export const profilePatchSchema = z
  .object({
    profile: candidateProfileSchema,
    preferences: preferencesSchema,
    answers: answersSchema,
    settings: settingsSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No fields to update");

export const sourceInputSchema = z.object({
  ats: z.enum(ATS_KINDS),
  boardToken: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, "Board name can only contain letters, numbers, . _ and -"),
  company: z.string().trim().max(120).default(""),
});

export const applicationPatchSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES),
    coverLetter: z.string().max(10_000),
    extraAnswers: z.record(z.string().max(200), z.string().max(4000)),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "No fields to update");

export const applicationViewSchema = z.enum(["review", "active", "done", "all"]).default("review");

export type SignupInput = z.infer<typeof signupSchema>;
export type ProfilePatch = z.infer<typeof profilePatchSchema>;
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type ApplicationPatch = z.infer<typeof applicationPatchSchema>;

/** Flattens a ZodError into `{ field: message }` for the form UI. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    result[key] ??= issue.message;
  }
  return result;
}
