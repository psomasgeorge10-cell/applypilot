/**
 * End-to-end pipeline tests against a real (in-memory) PostgreSQL, with the
 * job boards, the AI and the browser replaced by fakes.
 */

// Must come first: it configures the database before db.ts is evaluated.
import "./setup";

import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { getDb, migrate } from "../src/server/db";
import type { AiService, FormField } from "../src/server/ai";
import type { FormDriver } from "../src/server/submit/browser";
import type { FieldValue, ScrapedField } from "../src/server/submit/fields";
import { runPipeline } from "../src/server/pipeline";
import {
  addSource,
  createUser,
  getStats,
  listApplications,
  updateApplication,
  updateProfile,
} from "../src/server/repo";
import { submitApplication } from "../src/server/submit";
import { answersSchema, preferencesSchema } from "../src/lib/validation";
import type { CandidateProfile } from "../src/lib/types";

const PROFILE: CandidateProfile = {
  fullName: "Grace Hopper",
  email: "grace@example.com",
  phone: "555-0100",
  location: "Arlington, VA",
  headline: "Frontend Engineer",
  summary: "",
  yearsExperience: 10,
  skills: ["TypeScript", "React"],
  experience: [],
  education: [],
  links: [],
};

/** Scores are encoded in the fake postings' titles: "Frontend Engineer [92]". */
function fakeAi(calls: { scored: string[]; fields: FormField[][] }): AiService {
  return {
    async parseResume() {
      return PROFILE;
    },
    async scoreJob(_profile, _prefs, job) {
      calls.scored.push(job.title);
      const score = Number(/\[(\d+)\]/.exec(job.title)?.[1] ?? 50);
      return { score, summary: `Scored ${score}`, strengths: ["React"], gaps: [] };
    },
    async writeCoverLetter(_profile, _prefs, job) {
      return `Letter for ${job.title}`;
    },
    async answerFields(_profile, _answers, _job, _letter, fields) {
      calls.fields.push(fields);
      return fields.map((field) => ({
        key: field.key,
        answer: /why/i.test(field.label) ? "Because of the mission." : null,
      }));
    },
  };
}

const greenhouseBoard = {
  jobs: [
    { id: 1, title: "Frontend Engineer [92]", absolute_url: "https://x/1", location: { name: "Remote" }, content: "" },
    { id: 2, title: "Frontend Engineer [70]", absolute_url: "https://x/2", location: { name: "Remote" }, content: "" },
    { id: 3, title: "Frontend Engineer [40]", absolute_url: "https://x/3", location: { name: "Remote" }, content: "" },
    { id: 4, title: "Account Executive [99]", absolute_url: "https://x/4", location: { name: "Remote" }, content: "" },
  ],
};
const ashbyBoard = {
  jobs: [{ id: "a1", title: "Frontend Engineer [95]", jobUrl: "https://jobs.ashbyhq.com/beta/a1", isRemote: true }],
};

const fakeFetch = (async (url: string | URL | Request) => {
  const href = String(url);
  if (href.includes("greenhouse")) return Response.json(greenhouseBoard);
  if (href.includes("ashbyhq")) return Response.json(ashbyBoard);
  return new Response("", { status: 404 });
}) as typeof fetch;

/** A form with the standard fields plus whatever `extra` adds. */
function fakeDriver(log: { filled: Map<string, FieldValue>[]; submitted: number }, extra: ScrapedField[] = []) {
  return async (): Promise<FormDriver> => ({
    async open() {},
    async scrape() {
      return [
        { key: "first_name", label: "First Name *", kind: "text", options: [], required: true, isFile: false },
        { key: "last_name", label: "Last Name *", kind: "text", options: [], required: true, isFile: false },
        { key: "email", label: "Email *", kind: "text", options: [], required: true, isFile: false },
        { key: "resume", label: "Resume/CV", kind: "text", options: [], required: false, isFile: true, fileKind: "resume" },
        ...extra,
      ];
    },
    async fill(values) {
      log.filled.push(new Map(values));
    },
    async blockingCaptcha() {
      return null;
    },
    async submit() {
      log.submitted += 1;
      return { ok: true, message: "Application submitted" };
    },
    async close() {},
  });
}

let userId = 0;
let userCount = 0;

before(async () => {
  await migrate(await getDb());
});

beforeEach(async () => {
  userCount += 1;
  const user = await createUser({ name: "Grace", email: `grace${userCount}@example.com`, password: "password123" });
  userId = user.id;
  await updateProfile(userId, {
    profile: PROFILE,
    preferences: preferencesSchema.parse({ titles: ["Frontend Engineer"] }),
    answers: answersSchema.parse({}),
    settings: { autoApply: false, autoApplyMinScore: 85, reviewMinScore: 60, dailyApplyLimit: 10 },
  });
  await addSource(userId, { ats: "greenhouse", boardToken: "acme", company: "Acme" });
  await addSource(userId, { ats: "ashby", boardToken: "beta", company: "Beta" });
});

describe("runPipeline", () => {
  it("filters, scores and queues postings for review", async () => {
    const calls = { scored: [] as string[], fields: [] as FormField[][] };
    const report = await runPipeline(userId, { ai: fakeAi(calls), fetchImpl: fakeFetch });

    assert.equal(report.sourcesSynced, 2);
    assert.equal(report.filteredOut, 1, "the Account Executive role never reaches the model");
    assert.equal(report.scored, 4);
    assert.equal(report.suggested, 3, "92, 70 and the Ashby 95 clear the review threshold; 40 does not");
    assert.equal(report.autoApproved, 0);
    assert.ok(!calls.scored.some((title) => title.startsWith("Account")));

    const queue = await listApplications(userId, "review");
    assert.deepEqual(queue.map((a) => a.score), [95, 92, 70]);
    assert.equal(queue[1].coverLetter, "Letter for Frontend Engineer [92]");
    assert.equal(queue[0].canAutoApply, false, "Ashby postings are applied to manually");

    // A second run finds nothing new to score.
    const again = await runPipeline(userId, { ai: fakeAi(calls), fetchImpl: fakeFetch });
    assert.equal(again.scored, 0);
    assert.equal(calls.scored.length, 4);
  });

  it("auto-applies strong matches on supported boards only", async () => {
    await updateProfile(userId, {
      settings: { autoApply: true, autoApplyMinScore: 85, reviewMinScore: 60, dailyApplyLimit: 10 },
    });
    const log = { filled: [] as Map<string, FieldValue>[], submitted: 0 };
    const calls = { scored: [] as string[], fields: [] as FormField[][] };

    const report = await runPipeline(userId, {
      ai: fakeAi(calls),
      fetchImpl: fakeFetch,
      driver: fakeDriver(log),
      live: true,
    });

    assert.equal(report.autoApproved, 1, "only the Greenhouse 92 - the Ashby 95 cannot be auto-submitted");
    assert.equal(report.submitted, 1);
    assert.equal(log.submitted, 1);
    assert.deepEqual(log.filled[0].get("first_name"), { type: "text", value: "Grace" });
    assert.deepEqual(log.filled[0].get("resume"), undefined, "no resume file was uploaded for this user");

    const done = await listApplications(userId, "done");
    assert.equal(done.length, 1);
    assert.equal(done[0].status, "applied");
    assert.ok(done[0].appliedAt);
    assert.equal((await getStats(userId)).appliedToday, 1);
  });

  it("respects the daily limit", async () => {
    await updateProfile(userId, {
      settings: { autoApply: true, autoApplyMinScore: 60, reviewMinScore: 60, dailyApplyLimit: 1 },
    });
    const log = { filled: [] as Map<string, FieldValue>[], submitted: 0 };
    const report = await runPipeline(userId, {
      ai: fakeAi({ scored: [], fields: [] }),
      fetchImpl: fakeFetch,
      driver: fakeDriver(log),
      live: true,
    });
    assert.equal(report.autoApproved, 2);
    assert.equal(report.submitted, 1);
    const pending = await listApplications(userId, "active");
    assert.deepEqual(pending.map((a) => a.status), ["approved"], "the second waits for tomorrow");
  });
});

describe("submitApplication", () => {
  async function approvedApplication() {
    await runPipeline(userId, { ai: fakeAi({ scored: [], fields: [] }), fetchImpl: fakeFetch });
    const [top] = (await listApplications(userId, "review")).filter((a) => a.canAutoApply);
    await updateApplication(userId, top.id, { status: "applying" });
    return top.id;
  }

  it("sends unanswerable required questions back to the user, then applies once answered", async () => {
    const id = await approvedApplication();
    const log = { filled: [] as Map<string, FieldValue>[], submitted: 0 };
    const extra: ScrapedField[] = [
      { key: "q_why", label: "Why do you want to work here? *", kind: "textarea", options: [], required: true, isFile: false },
      { key: "q_clear", label: "Do you hold a security clearance? *", kind: "select", options: ["Yes", "No"], required: true, isFile: false },
    ];
    const calls = { scored: [] as string[], fields: [] as FormField[][] };

    const first = await submitApplication(userId, id, { ai: fakeAi(calls), driver: fakeDriver(log, extra), live: true });
    assert.equal(first, "needs_input");
    assert.equal(log.submitted, 0, "nothing is submitted half-filled");

    const [needsInput] = (await listApplications(userId, "review")).filter((a) => a.id === id);
    assert.equal(needsInput.status, "needs_input");
    assert.deepEqual(needsInput.pendingQuestions, [
      { key: "q_clear", label: "Do you hold a security clearance? *", options: ["Yes", "No"] },
    ]);

    await updateApplication(userId, id, { status: "applying", extraAnswers: { q_clear: "No" } });
    const second = await submitApplication(userId, id, { ai: fakeAi(calls), driver: fakeDriver(log, extra), live: true });
    assert.equal(second, "applied");
    assert.deepEqual(log.filled.at(-1)?.get("q_clear"), { type: "option", value: "No" });
    assert.deepEqual(log.filled.at(-1)?.get("q_why"), { type: "text", value: "Because of the mission." });
  });

  it("fills but does not submit in dry-run mode", async () => {
    const id = await approvedApplication();
    const log = { filled: [] as Map<string, FieldValue>[], submitted: 0 };
    const result = await submitApplication(userId, id, {
      ai: fakeAi({ scored: [], fields: [] }),
      driver: fakeDriver(log),
      live: false,
    });
    assert.equal(result, "failed");
    assert.equal(log.filled.length, 1);
    assert.equal(log.submitted, 0);
    const [app] = (await listApplications(userId, "active")).filter((a) => a.id === id);
    assert.match(app.lastError ?? "", /Dry run/);
  });
});
