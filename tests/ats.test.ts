/** Job-board adapters: payload mapping, HTML flattening and URL recognition. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BoardNotFoundError,
  fetchBoard,
  htmlToText,
  normalizeAshby,
  normalizeGreenhouse,
  normalizeLever,
  parseBoardUrl,
} from "../src/server/ats";

describe("htmlToText", () => {
  it("keeps paragraph and list structure", () => {
    const text = htmlToText("<p>About us</p><ul><li>React</li><li>Node</li></ul><p>Apply&nbsp;now &amp; soon</p>");
    assert.equal(text, "About us\n\n- React\n- Node\nApply now & soon");
  });

  it("decodes Greenhouse's entity-escaped HTML", () => {
    assert.equal(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;"), "Hello & welcome");
  });

  it("drops scripts and styles", () => {
    assert.equal(htmlToText("<style>p{}</style><p>Hi</p><script>alert(1)</script>"), "Hi");
  });
});

describe("normalizeGreenhouse", () => {
  it("maps a posting and points apply at the hosted form", () => {
    const [job] = normalizeGreenhouse("acme", {
      jobs: [
        {
          id: 4012,
          title: " Senior Engineer ",
          absolute_url: "https://acme.com/careers?gh_jid=4012",
          updated_at: "2026-09-01T10:00:00-04:00",
          location: { name: "Remote - US" },
          content: "&lt;p&gt;Build things&lt;/p&gt;",
        },
      ],
    });
    assert.equal(job.externalId, "4012");
    assert.equal(job.title, "Senior Engineer");
    assert.equal(job.remote, true);
    assert.equal(job.description, "Build things");
    assert.equal(job.applyUrl, "https://boards.greenhouse.io/embed/job_app?for=acme&token=4012");
    assert.equal(job.postedAt, "2026-09-01T14:00:00.000Z");
  });

  it("tolerates an empty or malformed payload", () => {
    assert.deepEqual(normalizeGreenhouse("acme", {}), []);
    assert.deepEqual(normalizeGreenhouse("acme", null), []);
  });
});

describe("normalizeLever", () => {
  it("combines description and lists and uses the workplace type", () => {
    const [job] = normalizeLever("acme", [
      {
        id: "abc-123",
        text: "Frontend Engineer",
        hostedUrl: "https://jobs.lever.co/acme/abc-123",
        applyUrl: "https://jobs.lever.co/acme/abc-123/apply",
        createdAt: 1_788_000_000_000,
        workplaceType: "remote",
        categories: { location: "Berlin" },
        descriptionPlain: "We make widgets.",
        lists: [{ text: "Requirements", content: "<li>TypeScript</li>" }],
        additionalPlain: "Benefits galore.",
      },
    ]);
    assert.equal(job.remote, true);
    assert.equal(job.location, "Berlin");
    assert.match(job.description, /We make widgets\.\n\nRequirements\n- TypeScript\n\nBenefits galore\./);
    assert.equal(job.applyUrl, "https://jobs.lever.co/acme/abc-123/apply");
  });

  it("derives the apply URL when the payload omits it", () => {
    const [job] = normalizeLever("acme", [{ id: "x", text: "PM", hostedUrl: "https://jobs.lever.co/acme/x" }]);
    assert.equal(job.applyUrl, "https://jobs.lever.co/acme/x/apply");
    assert.equal(job.remote, false);
  });
});

describe("normalizeAshby", () => {
  it("skips unlisted postings and joins secondary locations", () => {
    const jobs = normalizeAshby("acme", {
      jobs: [
        {
          id: "1",
          title: "Designer",
          location: "London",
          secondaryLocations: [{ location: "Paris" }],
          isRemote: false,
          jobUrl: "https://jobs.ashbyhq.com/acme/1",
          applyUrl: "https://jobs.ashbyhq.com/acme/1/application",
          descriptionPlain: "Design.",
          publishedAt: "2026-08-30T00:00:00Z",
        },
        { id: "2", title: "Hidden", isListed: false, jobUrl: "https://jobs.ashbyhq.com/acme/2" },
      ],
    });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].location, "London / Paris");
  });
});

describe("parseBoardUrl", () => {
  it("recognises each supported board", () => {
    assert.deepEqual(parseBoardUrl("https://boards.greenhouse.io/Acme"), { ats: "greenhouse", boardToken: "acme" });
    assert.deepEqual(parseBoardUrl("https://job-boards.greenhouse.io/acme/jobs/123"), { ats: "greenhouse", boardToken: "acme" });
    assert.deepEqual(parseBoardUrl("https://boards.greenhouse.io/embed/job_board?for=acme"), { ats: "greenhouse", boardToken: "acme" });
    assert.deepEqual(parseBoardUrl("https://jobs.lever.co/acme/abc-123"), { ats: "lever", boardToken: "acme" });
    assert.deepEqual(parseBoardUrl("https://jobs.ashbyhq.com/acme"), { ats: "ashby", boardToken: "acme" });
  });

  it("rejects anything else", () => {
    assert.equal(parseBoardUrl("https://www.linkedin.com/jobs/view/1"), null);
    assert.equal(parseBoardUrl("not a url"), null);
    assert.equal(parseBoardUrl("https://jobs.lever.co/"), null);
  });
});

describe("fetchBoard", () => {
  it("reports a missing board distinctly", async () => {
    const fakeFetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    await assert.rejects(fetchBoard("lever", "nope", fakeFetch), BoardNotFoundError);
  });

  it("normalizes what the endpoint returns", async () => {
    let requested = "";
    const fakeFetch = (async (url: string | URL | Request) => {
      requested = String(url);
      return Response.json([{ id: "a", text: "Engineer", hostedUrl: "https://jobs.lever.co/acme/a" }]);
    }) as typeof fetch;
    const jobs = await fetchBoard("lever", "acme", fakeFetch);
    assert.equal(requested, "https://api.lever.co/v0/postings/acme?mode=json");
    assert.equal(jobs[0].title, "Engineer");
  });
});
