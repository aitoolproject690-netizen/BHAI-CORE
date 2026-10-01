import { createWorkspace, cleanupWorkspace, createDeploymentWorkspace } from "./workspace.js";
import { checkoutGithubRepository } from "./source.js";
import { runCloudBuild } from "./cloudBuild.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createDeployment } from "./deployment.js";
import { createBuildPlan } from "./cloud.js";

function shouldCopySource(sourcePath) {
  const name = sourcePath.split(/[\\/]/).pop();
  return name !== ".git";
}

async function deriveBuildPlan(workspacePath, repository, branch) {
  const files = [];
  async function walk(dir, prefix = "") {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(full, rel);
      else if (["package.json","requirements.txt","pyproject.toml","go.mod","Cargo.toml","Dockerfile"].includes(entry.name)) files.push({ path: rel, content: await fs.readFile(full, "utf8") });
    }
  }
  await walk(workspacePath);
  return createBuildPlan({ repository, branch, files });
}

export async function executeCloudBuildJob({ ownerId, repository, branch = "main", plan } = {}) {
  const workspace = await createWorkspace({ ownerId, repository, branch });
  try {
    const checkout = await checkoutGithubRepository({
      workspacePath: workspace.path,
      repository,
      branch
    });
    const resolvedPlan = plan || await deriveBuildPlan(workspace.path, repository, branch);
    const build = await runCloudBuild({ plan: resolvedPlan, cwd: workspace.path });
    let deployment = null;
    if (build.ok) {
      const deploymentId = "dep_" + crypto.randomUUID();
      const target = await createDeploymentWorkspace({ ownerId, deploymentId });
      await fs.cp(workspace.path, target.path, { recursive: true, force: true, filter: shouldCopySource });
      deployment = await createDeployment({ ownerId, repository, branch, buildId: deploymentId, path: target.path });
    }
    return {
      status: build.ok ? "succeeded" : "failed",
      workspaceId: workspace.id,
      repository,
      branch,
      checkout: { ok: checkout.ok, path: checkout.path },
      build,
      deployment
    };
  } finally {
    await cleanupWorkspace(workspace);
  }
}

export function cloudJobInfo() {
  return {
    workspaceCleanup: "always",
    source: "github",
    buildRunner: "bounded"
  };
}
