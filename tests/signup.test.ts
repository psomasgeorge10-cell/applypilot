/** The sign-up allowlist. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signupAllowed } from "../src/server/signup";

describe("signupAllowed", () => {
  it("allows everyone when unset or *", () => {
    assert.ok(signupAllowed("a@b.com", undefined));
    assert.ok(signupAllowed("a@b.com", ""));
    assert.ok(signupAllowed("a@b.com", "*"));
  });

  it("matches exact emails and domains, case-insensitively", () => {
    const list = "Me@Example.com, @team.io";
    assert.ok(signupAllowed("me@example.com", list));
    assert.ok(signupAllowed("anyone@TEAM.io", list));
    assert.ok(!signupAllowed("other@example.com", list));
    assert.ok(!signupAllowed("x@notteam.io", list));
  });
});
