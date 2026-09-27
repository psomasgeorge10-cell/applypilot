/**
 * Deciding what goes into each application form field.
 *
 * Pure functions, separate from the browser code, so the rules that matter
 * most - never guess a factual answer, never pick an option that is not on the
 * form - are unit tested without launching Chromium.
 *
 * Resolution order for every field:
 *   1. an answer the user typed for this very application (pending questions)
 *   2. a deterministic match against the profile and saved answers
 *   3. the AI, for whatever is left (see ai.ts `answerFields`)
 * A required field that is still empty after that sends the application back
 * to the user as "needs input" instead of being submitted half-filled.
 */

import type { CandidateProfile, ScreeningAnswers } from "@/lib/types";
import type { FormField } from "../ai";

/** A field as scraped from the page, before any value is chosen. */
export interface ScrapedField extends FormField {
  /** For file inputs: what the upload is for, guessed from its label. */
  fileKind?: "resume" | "cover_letter" | "other";
  isFile: boolean;
}

export type FieldValue =
  | { type: "text"; value: string }
  | { type: "option"; value: string }
  | { type: "check"; value: boolean }
  | { type: "file"; file: "resume" | "cover_letter" };

export interface FillContext {
  profile: CandidateProfile;
  answers: ScreeningAnswers;
  coverLetter: string;
  extraAnswers: Record<string, string>;
  hasResumeFile: boolean;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*:?()]/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function link(profile: CandidateProfile, pattern: RegExp): string {
  return profile.links.find((l) => pattern.test(l.url) || pattern.test(l.label))?.url ?? "";
}

/**
 * Picks the form option that corresponds to a free-text answer, or null when
 * none clearly does. "Yes, I am authorized" matches an option "Yes"; an answer
 * that matches several options equally well matches none of them.
 */
export function matchOption(answer: string, options: string[]): string | null {
  if (!answer || options.length === 0) return null;
  const target = normalize(answer);

  const exact = options.find((option) => normalize(option) === target);
  if (exact) return exact;

  const leadingWord = target.split(" ")[0];
  if (leadingWord === "yes" || leadingWord === "no") {
    const polar = options.filter((option) => normalize(option).split(" ")[0] === leadingWord);
    if (polar.length === 1) return polar[0];
  }

  const containing = options.filter((option) => {
    const normalized = normalize(option);
    return normalized.length > 0 && (target.includes(normalized) || normalized.includes(target));
  });
  return containing.length === 1 ? containing[0] : null;
}

/** Rules keyed on the field's label/name. First matching rule wins. */
function deterministicText(field: ScrapedField, ctx: FillContext): string | undefined {
  const label = normalize(`${field.label} ${field.key}`);
  const { profile, answers } = ctx;
  const name = splitName(profile.fullName);
  const has = (pattern: RegExp) => pattern.test(label);

  if (has(/\bfirst.?name\b|\bgiven name\b/)) return name.first;
  if (has(/\blast.?name\b|\bsurname\b|\bfamily name\b/)) return name.last;
  if (has(/\bpreferred.?name\b/)) return name.first;
  if (has(/^(full )?name\b|\bfull.?name\b|^name$/)) return profile.fullName;
  if (has(/\be.?mail\b/)) return profile.email;
  if (has(/\bphone\b|\bmobile\b/)) return profile.phone;
  if (has(/linkedin/)) return answers.linkedin || link(profile, /linkedin/i);
  if (has(/github/)) return answers.github || link(profile, /github/i);
  if (has(/portfolio|website|personal (site|url)|\burls? other\b/)) {
    return answers.website || link(profile, /^(?!.*(linkedin|github)).*/i);
  }
  if (has(/\bpronouns?\b/)) return answers.pronouns;
  if (has(/sponsor/)) return answers.requiresSponsorship;
  if (has(/authori[sz]ed|work (permit|authori[sz]ation)|right to work|legally (able|eligible)/)) {
    return answers.workAuthorization;
  }
  if (has(/salary|compensation|pay expectation/)) return answers.salaryExpectation;
  if (has(/notice period|start date|when can you start|earliest start/)) return answers.noticePeriod;
  if (has(/relocat/)) return answers.willingToRelocate;
  if (has(/current (company|employer)|^org\b|\borganization\b/)) return profile.experience[0]?.company;
  if (has(/current (title|role|position)/)) return profile.experience[0]?.title;
  if (has(/\b(city|location)\b|where are you (based|located)/)) return profile.location;
  if (field.kind === "textarea" && has(/cover letter|additional information|anything else|^comments?\b/)) {
    return ctx.coverLetter;
  }

  const custom = answers.custom.find((entry) => {
    const question = normalize(entry.question);
    return question.length > 3 && (label.includes(question) || normalize(field.label).includes(question));
  });
  return custom?.answer;
}

/**
 * The value this field should get without asking the AI, or undefined when
 * there is no confident deterministic answer.
 */
export function resolveField(field: ScrapedField, ctx: FillContext): FieldValue | undefined {
  if (field.isFile) {
    if (field.fileKind === "resume" && ctx.hasResumeFile) return { type: "file", file: "resume" };
    if (field.fileKind === "cover_letter" && ctx.coverLetter) return { type: "file", file: "cover_letter" };
    return undefined;
  }

  const answer = ctx.extraAnswers[field.key] ?? deterministicText(field, ctx);
  if (answer === undefined || answer.trim() === "") return undefined;
  return coerce(field, answer);
}

/** Turns a text answer into the right kind of value for the field, or undefined if it does not fit. */
export function coerce(field: FormField, answer: string): FieldValue | undefined {
  if (field.kind === "checkbox") {
    const normalized = normalize(answer);
    if (/^(yes|true|agree|i agree|checked)\b/.test(normalized)) return { type: "check", value: true };
    if (/^(no|false|unchecked)\b/.test(normalized)) return { type: "check", value: false };
    return undefined;
  }
  if (field.kind === "select" || field.kind === "radio") {
    const option = matchOption(answer, field.options);
    return option ? { type: "option", value: option } : undefined;
  }
  return { type: "text", value: answer };
}

export interface FillPlan {
  values: Map<string, FieldValue>;
  /** Fields to hand to the AI. */
  forAi: FormField[];
}

export function planFill(fields: ScrapedField[], ctx: FillContext): FillPlan {
  const values = new Map<string, FieldValue>();
  const forAi: FormField[] = [];
  for (const field of fields) {
    const value = resolveField(field, ctx);
    if (value) {
      values.set(field.key, value);
    } else if (!field.isFile) {
      forAi.push({
        key: field.key,
        label: field.label,
        kind: field.kind,
        options: field.options,
        required: field.required,
      });
    }
  }
  return { values, forAi };
}

/** Required fields that still have no value - the questions to put to the user. */
export function unansweredRequired(fields: ScrapedField[], values: Map<string, FieldValue>): ScrapedField[] {
  return fields.filter((field) => field.required && !values.has(field.key));
}
