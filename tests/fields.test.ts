/** Choosing form values: the rules that keep the submitter from guessing. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchOption, planFill, resolveField, unansweredRequired, type FillContext, type ScrapedField } from "../src/server/submit/fields";
import { answersSchema } from "../src/lib/validation";
import type { CandidateProfile } from "../src/lib/types";

const profile: CandidateProfile = {
  fullName: "Ada Mary Lovelace",
  email: "ada@example.com",
  phone: "+44 20 0000 0000",
  location: "London",
  headline: "Engineer",
  summary: "",
  yearsExperience: 8,
  skills: [],
  experience: [{ title: "Lead Engineer", company: "Analytical Engines", start: "2019", end: "Present", highlights: [] }],
  education: [],
  links: [{ label: "GitHub", url: "https://github.com/ada" }],
};

function ctx(overrides: Partial<FillContext> = {}): FillContext {
  return {
    profile,
    answers: answersSchema.parse({ requiresSponsorship: "No", custom: [{ question: "Years of React experience", answer: "6" }] }),
    coverLetter: "Dear team...",
    extraAnswers: {},
    hasResumeFile: true,
    ...overrides,
  };
}

function field(overrides: Partial<ScrapedField>): ScrapedField {
  return { key: "k", label: "", kind: "text", options: [], required: false, isFile: false, ...overrides };
}

describe("matchOption", () => {
  it("matches exactly, by yes/no, or by unique containment", () => {
    assert.equal(matchOption("no", ["Yes", "No"]), "No");
    assert.equal(matchOption("Yes, I am authorized", ["Yes", "No"]), "Yes");
    assert.equal(matchOption("London", ["London, UK", "Paris, FR"]), "London, UK");
  });

  it("refuses ambiguous or absent matches", () => {
    assert.equal(matchOption("Yes", ["Yes - US", "Yes - EU", "No"]), null);
    assert.equal(matchOption("Maybe", ["Yes", "No"]), null);
    assert.equal(matchOption("", ["Yes"]), null);
  });
});

describe("resolveField", () => {
  it("fills identity fields from the profile", () => {
    assert.deepEqual(resolveField(field({ key: "first_name", label: "First Name" }), ctx()), { type: "text", value: "Ada" });
    assert.deepEqual(resolveField(field({ key: "last_name", label: "Last Name" }), ctx()), { type: "text", value: "Mary Lovelace" });
    assert.deepEqual(resolveField(field({ key: "name", label: "Full name" }), ctx()), { type: "text", value: "Ada Mary Lovelace" });
    assert.deepEqual(resolveField(field({ key: "urls[GitHub]", label: "GitHub URL" }), ctx()), { type: "text", value: "https://github.com/ada" });
    assert.deepEqual(resolveField(field({ key: "org", label: "Current company" }), ctx()), { type: "text", value: "Analytical Engines" });
  });

  it("maps saved answers onto select options", () => {
    const sponsor = field({ key: "q1", label: "Will you require visa sponsorship?", kind: "select", options: ["Yes", "No"] });
    assert.deepEqual(resolveField(sponsor, ctx()), { type: "option", value: "No" });
  });

  it("uses custom saved answers", () => {
    assert.deepEqual(resolveField(field({ key: "q2", label: "Years of React experience *" }), ctx()), { type: "text", value: "6" });
  });

  it("prefers the user's per-application answer", () => {
    const f = field({ key: "q9", label: "Favourite colour" });
    assert.equal(resolveField(f, ctx()), undefined);
    assert.deepEqual(resolveField(f, ctx({ extraAnswers: { q9: "Blue" } })), { type: "text", value: "Blue" });
  });

  it("never invents an answer that is not stored", () => {
    const auth = field({ key: "q3", label: "Are you legally authorized to work in the US?", kind: "radio", options: ["Yes", "No"] });
    assert.equal(resolveField(auth, ctx()), undefined, "workAuthorization is blank, so this must go unanswered");
  });

  it("attaches the resume and puts the letter in the comments box", () => {
    assert.deepEqual(resolveField(field({ key: "resume", label: "Resume/CV", isFile: true, fileKind: "resume" }), ctx()), {
      type: "file",
      file: "resume",
    });
    assert.equal(resolveField(field({ key: "resume", isFile: true, fileKind: "resume" }), ctx({ hasResumeFile: false })), undefined);
    assert.deepEqual(resolveField(field({ key: "comments", label: "Additional information", kind: "textarea" }), ctx()), {
      type: "text",
      value: "Dear team...",
    });
  });
});

describe("planFill", () => {
  it("routes unresolved non-file fields to the AI and reports missing required ones", () => {
    const fields = [
      field({ key: "email", label: "Email", required: true }),
      field({ key: "why", label: "Why do you want to work here?", kind: "textarea", required: true }),
      field({ key: "portfolio_pdf", label: "Portfolio", isFile: true, fileKind: "other", required: true }),
    ];
    const plan = planFill(fields, ctx());
    assert.deepEqual(plan.forAi.map((f) => f.key), ["why"]);
    assert.deepEqual(unansweredRequired(fields, plan.values).map((f) => f.key), ["why", "portfolio_pdf"]);
  });
});
