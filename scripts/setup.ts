/**
 * Database setup.
 *
 *   npm run db:setup            apply the schema, then create the demo account if missing
 *   npm run db:setup -- --force delete the demo account and recreate it
 *
 * The demo account comes with a filled-in profile and a handful of example
 * applications in every state, so the UI can be explored before an API key or
 * any job boards are configured. The example postings belong to fictional
 * companies and are never submitted anywhere (their board is not watched).
 */

import { config as loadEnv } from "dotenv";
import { getDb, migrate, type Database } from "../src/server/db";
import { createUser, createApplication, updateApplication, updateProfile, upsertJobs } from "../src/server/repo";
import type { ApplicationStatus, CandidateProfile } from "../src/lib/types";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const DEMO = {
  name: "Demo Candidate",
  email: "demo@example.com",
  password: process.env.SEED_DEMO_PASSWORD ?? "password123",
};

const PROFILE: CandidateProfile = {
  fullName: "Demo Candidate",
  email: "demo@example.com",
  phone: "+1 555 0100",
  location: "Austin, TX",
  headline: "Senior Frontend Engineer",
  summary:
    "Frontend engineer with 7 years building React applications, design systems and performance tooling for B2B SaaS products.",
  yearsExperience: 7,
  skills: ["TypeScript", "React", "Next.js", "Node.js", "GraphQL", "Design systems", "Accessibility", "PostgreSQL"],
  experience: [
    {
      title: "Senior Frontend Engineer",
      company: "Northwind Analytics",
      start: "2021",
      end: "Present",
      highlights: [
        "Led the migration of a 400-screen dashboard to Next.js, cutting median page load from 3.1s to 1.2s",
        "Built and maintained the company design system used by 6 product teams",
      ],
    },
    {
      title: "Frontend Engineer",
      company: "Contoso Health",
      start: "2018",
      end: "2021",
      highlights: ["Shipped the patient scheduling app used by 120 clinics", "Brought core flows to WCAG 2.1 AA"],
    },
  ],
  education: [{ school: "University of Texas at Austin", degree: "B.S. Computer Science", year: "2017" }],
  links: [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/demo-candidate" },
    { label: "GitHub", url: "https://github.com/demo-candidate" },
  ],
};

const EXAMPLES: {
  title: string;
  company: string;
  location: string;
  remote: boolean;
  status: ApplicationStatus;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}[] = [
  {
    title: "Senior Frontend Engineer, Design Systems",
    company: "Example Robotics",
    location: "Remote - US",
    remote: true,
    status: "suggested",
    score: 92,
    summary: "A near-exact match: senior React role centred on a design system, which you have led before.",
    strengths: ["Design system leadership", "Next.js migration experience", "Accessibility work"],
    gaps: ["No Storybook mentioned on your resume"],
  },
  {
    title: "Staff Software Engineer, Web Platform",
    company: "Example Payments",
    location: "Austin, TX",
    remote: false,
    status: "suggested",
    score: 74,
    summary: "Strong technical fit, but the staff level asks for more cross-org leadership than your resume shows.",
    strengths: ["Performance tooling", "TypeScript depth"],
    gaps: ["Staff-level scope", "Payments domain"],
  },
  {
    title: "Frontend Engineer",
    company: "Example Climate",
    location: "Remote",
    remote: true,
    status: "needs_input",
    score: 81,
    summary: "Good fit on stack and seniority; the form asked a question you have not answered yet.",
    strengths: ["React + GraphQL", "B2B SaaS background"],
    gaps: [],
  },
  {
    title: "Senior UI Engineer",
    company: "Example Logistics",
    location: "Remote - Americas",
    remote: true,
    status: "applied",
    score: 88,
    summary: "Strong match on UI architecture and performance work.",
    strengths: ["Dashboard performance", "Design systems"],
    gaps: [],
  },
  {
    title: "Frontend Engineer II",
    company: "Example Media",
    location: "New York, NY",
    remote: false,
    status: "interview",
    score: 79,
    summary: "Solid fit; the role is one level below your current seniority.",
    strengths: ["React", "Accessibility"],
    gaps: ["Video streaming experience"],
  },
];

const COVER_LETTER = `The chance to shape a design system that several product teams build on is exactly the work I have enjoyed most over the last few years.

At Northwind Analytics I led the migration of a 400-screen dashboard to Next.js, bringing median page load from 3.1 seconds to 1.2, and I maintain the design system six product teams use every day. Before that, at Contoso Health, I shipped a scheduling app used by 120 clinics and brought its core flows to WCAG 2.1 AA.

I would love to bring that mix of platform thinking and attention to accessibility to your team.

Demo Candidate`;

async function removeDemo(db: Database) {
  await db.query(`DELETE FROM users WHERE email = $1`, [DEMO.email]);
  await db.query(`DELETE FROM jobs WHERE board_token = 'applypilot-demo'`);
}

async function seed(db: Database) {
  const user = await createUser(DEMO, db);
  await updateProfile(
    user.id,
    {
      profile: PROFILE,
      preferences: {
        titles: ["Frontend Engineer", "UI Engineer", "Software Engineer"],
        locations: ["Austin", "Remote"],
        remote: "any",
        excludeKeywords: ["intern", "clearance"],
        minSalary: 150000,
        seniority: "Senior",
        notes: "Prefer product companies; no crypto.",
      },
      answers: {
        workAuthorization: "Yes",
        requiresSponsorship: "No",
        noticePeriod: "2 weeks",
        salaryExpectation: "$170,000",
        willingToRelocate: "No",
        linkedin: "https://www.linkedin.com/in/demo-candidate",
        github: "https://github.com/demo-candidate",
        website: "",
        pronouns: "",
        custom: [],
      },
    },
    db,
  );

  await upsertJobs(
    "greenhouse",
    "applypilot-demo",
    "Example",
    EXAMPLES.map((example, index) => ({
      externalId: `demo-${index + 1}`,
      title: example.title,
      location: example.location,
      remote: example.remote,
      url: "https://example.com/careers",
      applyUrl: "https://example.com/careers",
      description: `${example.company} is hiring a ${example.title}. This is an example posting created by npm run db:setup.`,
      postedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    })),
    db,
  );
  // Each example belongs to a different fictional company.
  for (const [index, example] of EXAMPLES.entries()) {
    await db.query(`UPDATE jobs SET company = $1 WHERE board_token = 'applypilot-demo' AND external_id = $2`, [
      example.company,
      `demo-${index + 1}`,
    ]);
  }

  const { rows: jobs } = await db.query<{ id: number; external_id: string }>(
    `SELECT id, external_id FROM jobs WHERE board_token = 'applypilot-demo' ORDER BY external_id`,
  );
  for (const [index, example] of EXAMPLES.entries()) {
    const job = jobs.find((row) => row.external_id === `demo-${index + 1}`)!;
    const id = await createApplication(
      {
        userId: user.id,
        jobId: job.id,
        status: example.status,
        match: { score: example.score, summary: example.summary, strengths: example.strengths, gaps: example.gaps },
        coverLetter: COVER_LETTER,
      },
      db,
    );
    if (example.status === "needs_input") {
      await updateApplication(
        user.id,
        id,
        {
          pendingQuestions: [
            {
              key: "question_4821",
              label: "Have you worked with a component library in production? Which one?",
              options: [],
            },
          ],
        },
        db,
      );
    }
    if (["applied", "interview"].includes(example.status)) {
      await updateApplication(user.id, id, { appliedAt: "now" }, db);
    }
  }

  console.log(`Created the demo account (${DEMO.email} / ${DEMO.password}) with ${EXAMPLES.length} example applications.`);
}

async function main() {
  const force = process.argv.includes("--force");
  const db = await getDb();
  console.log(`Using the ${db.driver} driver.`);
  await migrate(db);
  console.log("Schema is up to date.");

  const { rows } = await db.query<{ id: number }>(`SELECT id FROM users WHERE email = $1`, [DEMO.email]);
  if (rows[0] && !force) {
    console.log("The demo account already exists - nothing to do. Re-run with --force to recreate it.");
  } else {
    if (rows[0]) await removeDemo(db);
    await seed(db);
  }
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
