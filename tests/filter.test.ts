/** Deterministic pre-filtering against user preferences. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prefilter, titleMatches } from "../src/server/filter";
import { preferencesSchema } from "../src/lib/validation";

const prefs = (overrides: Record<string, unknown> = {}) => preferencesSchema.parse(overrides);
const job = (overrides: Partial<{ title: string; location: string; remote: boolean; description: string }> = {}) => ({
  title: "Senior Front-End Software Engineer",
  location: "Austin, TX",
  remote: false,
  description: "Build our React app.",
  ...overrides,
});

describe("titleMatches", () => {
  it("ignores punctuation, seniority and extra words", () => {
    assert.ok(titleMatches("Senior Front-End Software Engineer", "Frontend Engineer"));
    assert.ok(titleMatches("Staff Engineer, Web Platform", "Web Engineer"));
  });

  it("rejects unrelated titles", () => {
    assert.ok(!titleMatches("Account Executive", "Frontend Engineer"));
    assert.ok(!titleMatches("Backend Engineer", "Product Designer"));
  });
});

describe("prefilter", () => {
  it("lets everything through with empty preferences", () => {
    assert.deepEqual(prefilter(job(), prefs()), { ok: true });
  });

  it("filters on title", () => {
    assert.equal(prefilter(job({ title: "Sales Manager" }), prefs({ titles: ["Frontend Engineer"] })).ok, false);
    assert.equal(prefilter(job(), prefs({ titles: ["Data Scientist", "Frontend Engineer"] })).ok, true);
  });

  it("filters excluded keywords on word boundaries", () => {
    assert.equal(prefilter(job({ title: "Frontend Intern" }), prefs({ excludeKeywords: ["intern"] })).ok, false);
    // "internal" must not trip "intern".
    assert.equal(prefilter(job({ description: "Internal tools team" }), prefs({ excludeKeywords: ["intern"] })).ok, true);
  });

  it("enforces remote-only", () => {
    assert.equal(prefilter(job(), prefs({ remote: "remote_only" })).ok, false);
    assert.equal(prefilter(job({ remote: true }), prefs({ remote: "remote_only" })).ok, true);
  });

  it("filters on location, but never remote or unstated ones", () => {
    const wanted = prefs({ locations: ["Berlin", "London"] });
    assert.equal(prefilter(job(), wanted).ok, false);
    assert.equal(prefilter(job({ location: "London, UK" }), wanted).ok, true);
    assert.equal(prefilter(job({ remote: true }), wanted).ok, true);
    assert.equal(prefilter(job({ location: "" }), wanted).ok, true);
  });
});
