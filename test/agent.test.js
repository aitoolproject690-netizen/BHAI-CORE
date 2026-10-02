import test from "node:test";
import assert from "node:assert/strict";
import { listAgentTools } from "../src/agent.js";

test("agent exposes core tools", () => {
  const names = listAgentTools().map(x => x.name);
  assert.deepEqual(names, ["chat","rag_search","rag_context","vision_analyze","image_generate","voice_transcribe","voice_synthesize","models","job_create","job_get","github_repo_list","github_repo_get","github_file_read","github_file_write","github_repo_create","cloud_build_plan","cloud_build_execute","cloud_service_create","cloud_deployment_update"]);
});

test("agent tool metadata is safe to expose", () => {
  const tools = listAgentTools();
  assert.ok(tools.every(tool => !JSON.stringify(tool).match(/api[_-]?key|secret|token/i)));
});

test("agent jobs are isolated by authenticated owner", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { getStoredJob } = await import("../src/queue.js");
  const { executeAgentTool } = await import("../src/agent.js");

  resetStoreForTests();
  const ownerA = { id: "owner-a" };
  const ownerB = { id: "owner-b" };

  const created = await executeAgentTool("job_create", {
    type: "demo",
    payload: { value: 1, ownerId: "attacker-supplied" }
  }, ownerA);

  assert.equal(created.ownerId, "owner-a");
  assert.ok(await getStoredJob(created.id, "owner-a"));
  assert.equal(await executeAgentTool("job_get", { id: created.id }, ownerB), null);
  assert.ok(await executeAgentTool("job_get", { id: created.id }, ownerA));
});


test("expired high-risk approvals cannot be executed", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");

  resetStoreForTests();
  const identity = { id: "owner-expiry", scopes: ["*"] };
  const approval = await createApproval({
    actorId: identity.id,
    tool: "github_repo_create",
    input: { name: "expired-repo", private: true }
  });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));

  const { getStore, updateStore } = await import("../src/store.js");
  await updateStore(store => {
    store.approvals[approval.id].expiresAt = new Date(Date.now() - 1000).toISOString();
    return store;
  });

  await assert.rejects(
    () => executeAgentTool("github_repo_create", { name: "expired-repo", private: true }, identity, { approvalId: approval.id }),
    error => error.code === "APPROVAL_REQUIRED" && error.status === 428
  );
  assert.ok(await getStore());
});

test("approved high-risk agent actions are bound to the approved input", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");

  resetStoreForTests();
  const identity = { id: "owner-approval", scopes: ["*"] };
  const approval = await createApproval({
    actorId: identity.id,
    tool: "github_repo_create",
    input: { name: "approved-repo", private: true }
  });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));

  await assert.rejects(
    () => executeAgentTool("github_repo_create", { name: "different-repo", private: true }, identity, { approvalId: approval.id }),
    error => error.code === "APPROVAL_REQUIRED" && error.status === 428
  );
});


test("cloud service creation requires the cloud build permission", async () => {
  const { executeAgentTool } = await import("../src/agent.js");
  await assert.rejects(
    () => executeAgentTool("cloud_service_create", {
      buildId: "build-1",
      command: "node server.js",
      cwd: process.cwd()
    }, { id: "owner-no-cloud", scopes: ["agent:read", "agent:write"] }),
    error => error.code === "PERMISSION_DENIED" && error.status === 403
  );
});

test("cloud service creation requires an approved exact input", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");

  resetStoreForTests();
  const identity = { id: "owner-cloud-service", scopes: ["cloud:build", "agent:write"] };
  const input = { buildId: "build-1", command: "node server.js", cwd: process.cwd() };
  const approval = await createApproval({ actorId: identity.id, tool: "cloud_service_create", input });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));

  await assert.rejects(
    () => executeAgentTool("cloud_service_create", { ...input, command: "node other.js" }, identity, { approvalId: approval.id }),
    error => error.code === "APPROVAL_REQUIRED" && error.status === 428
  );
});


test("deployment mutations require cloud build permission and exact approval", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");
  resetStoreForTests();
  const denied = { id: "owner-no-deploy", scopes: ["agent:read", "agent:write"] };
  await assert.rejects(
    () => executeAgentTool("cloud_deployment_update", { deploymentId: "dep-1", action: "promote" }, denied),
    error => error.code === "PERMISSION_DENIED" && error.status === 403
  );
  const identity = { id: "owner-deploy", scopes: ["cloud:build", "agent:write"] };
  const input = { deploymentId: "dep-1", action: "rollback" };
  const approval = await createApproval({ actorId: identity.id, tool: "cloud_deployment_update", input });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));
  await assert.rejects(
    () => executeAgentTool("cloud_deployment_update", { ...input, deploymentId: "dep-2" }, identity, { approvalId: approval.id }),
    error => error.code === "APPROVAL_REQUIRED" && error.status === 428
  );
});


test("cloud build execution rejects a cwd outside the authenticated owner workspace", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");
  resetStoreForTests();
  const identity = { id: "owner-build-path", scopes: ["cloud:build", "agent:write"] };
  const input = { plan: { runtime: "node", commands: { test: "printf safe" } }, cwd: process.cwd() };
  const approval = await createApproval({ actorId: identity.id, tool: "cloud_build_execute", input });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));
  await assert.rejects(
    () => executeAgentTool("cloud_build_execute", input, identity, { approvalId: approval.id }),
    error => error.code === "EXECUTION_PATH_FORBIDDEN" && error.status === 403
  );
});

test("cloud service creation rejects a cwd outside the authenticated owner workspace", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { createApproval, decideApproval } = await import("../src/approval.js");
  const { executeAgentTool } = await import("../src/agent.js");
  resetStoreForTests();
  const identity = { id: "owner-service-path", scopes: ["cloud:build", "agent:write"] };
  const input = { buildId: "build-1", command: "node server.js", cwd: process.cwd() };
  const approval = await createApproval({ actorId: identity.id, tool: "cloud_service_create", input });
  assert.ok(await decideApproval(approval.id, identity.id, "approved"));
  await assert.rejects(
    () => executeAgentTool("cloud_service_create", input, identity, { approvalId: approval.id }),
    error => error.code === "EXECUTION_PATH_FORBIDDEN" && error.status === 403
  );
});


test("agent execution writes terminal audit status for success and failure", async () => {
  const { resetStoreForTests } = await import("../src/store.js");
  const { listAudit } = await import("../src/audit.js");
  const { executeAgentTool } = await import("../src/agent.js");

  resetStoreForTests();
  const identity = { id: "owner-audit", scopes: ["agent:read", "agent:write", "files:read"] };

  const created = await executeAgentTool("job_create", { type: "audit-demo", payload: {} }, identity, { requestId: "req-success" });
  assert.equal(created.ownerId, identity.id);

  await assert.rejects(
    () => executeAgentTool("rag_search", {}, identity, { requestId: "req-failure" }),
    /query is required/
  );

  const events = await listAudit({ actorId: identity.id, limit: 10 });
  const terminal = events.filter(event => event.action === "agent.execute" && ["completed", "failed"].includes(event.status));
  assert.equal(terminal.length, 2);
  assert.ok(terminal.some(event => event.requestId === "req-success" && event.status === "completed"));
  assert.ok(terminal.some(event => event.requestId === "req-failure" && event.status === "failed"));
  assert.ok(terminal.every(event => event.metadata === undefined || !/bhai_|AIza|sk-/.test(event.metadata)));
});
