import test from "node:test";
import assert from "node:assert/strict";
import { planAgentRequest, validatePlan } from "../src/planner.js";

test("planner maps normal requests to chat", () => {
  const plan = planAgentRequest({ text: "hello bhai" });
  assert.equal(plan[0].tool, "chat");
});

test("planner maps file searches to RAG", () => {
  const plan = planAgentRequest({ text: "search my files for invoice" });
  assert.equal(plan[0].tool, "rag_search");
});

test("planner rejects unknown tools", () => {
  assert.throws(() => planAgentRequest({ tool: "secret_tool" }), /Unknown agent tool/);
});

test("planner enforces dependency ordering", () => {
  assert.throws(() => validatePlan([
    { id: "two", tool: "models", dependsOn: ["one"] },
    { id: "one", tool: "models", dependsOn: [] }
  ]), /earlier step/);
});
