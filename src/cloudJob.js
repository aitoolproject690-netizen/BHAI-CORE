import { createWorkspace, cleanupWorkspace, createDeploymentWorkspace } from "./workspace.js";
import { checkoutGithubRepository } from "./source.js";
import { runCloudBuild } from "./cloudBuild.js";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createDeployment } from "./deployment.js";

export async function executeCloudBuildJob({ ownerId, repository, branch = "main", plan } = {}) {
  const workspace = await createWorkspace({ ownerId, repository, branch });
  try {
    const checkout = await checkoutGithubRepository({
      workspacePath: workspace.path,
      repository,
      branch
    });
    const build = await runCloudBuild({ plan, cwd: workspace.path });
    let deployment = null;
    if (build.ok) {
      const deploymentId = "dep_" + crypto.randomUUID();
      const target = await createDeploymentWorkspace({ ownerId, deploymentId });
      await fs.cp(workspace.path, target.path, { recursive: true, force: true, filter: (src) => !src.includes(path.sep + ".git" + path.sep) });
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
