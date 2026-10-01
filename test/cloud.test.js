import test from "node:test";
import assert from "node:assert/strict";
import { createBuildPlan } from "../src/cloud.js";

test("Node project gets package-script build plan", () => {
  const plan = createBuildPlan({
    repository: "owner/app",
    branch: "main",
    repo: { defaultBranch: "main" },
    files: [{ path: "package.json", content: JSON.stringify({
      scripts: { build: "npm run build", test: "npm test", start: "node server.js" },
      dependencies: { vite: "x" }
    }) }]
  });
  assert.equal(plan.runtime, "node");
  assert.equal(plan.framework, "vite");
  assert.equal(plan.commands.build, "npm run build");
  assert.equal(plan.commands.test, "npm test");
  assert.equal(plan.commands.start, "node server.js");
  assert.equal(plan.deployable, true);
});

test("Unknown project is not marked deployable", () => {
  const plan = createBuildPlan({ repository: "owner/x", files: [{ path: "README.md", content: "hi" }] });
  assert.equal(plan.runtime, "unknown");
  assert.equal(plan.deployable, false);
});
