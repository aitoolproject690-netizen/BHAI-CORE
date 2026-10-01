import { createWorkspace, cleanupWorkspace, createDeploymentWorkspace } from "./workspace.js";
import { checkoutGithubRepository } from "./source.js";
import { runCloudBuild } from "./cloudBuild.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createDeployment } from "./deployment.js";\nimport { createBuildPlan } from "./cloud.js";

function shouldCopySource(sourcePath) {
  const name = sourcePath.split(/[\\/]/).pop();
  return name !== ".git";
}

async function deriveBuildPlan(workspacePath, repository, branch) {\n  const files = [];\n  async function walk(dir, prefix = "") {\n    const entries = await fs.readdir(dir, { withFileTypes: true });\n    for (const entry of entries) {\n      if (entry.name === ".git" || entry.name === "node_modules") continue;\n      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;\n      const full = `${dir}/${entry.name}`;\n      if (entry.isDirectory()) await walk(full, rel);\n      else if (["package.json","requirements.txt","pyproject.toml","go.mod","Cargo.toml","Dockerfile"].includes(entry.name)) files.push({ path: rel, content: await fs.readFile(full, "utf8") });\n    }\n  }\n  await walk(workspacePath);\n  return createBuildPlan({ repository, branch, files });\n}\n\nexport async function executeCloudBuildJob({ ownerId, repository, branch = "main", plan } = {}) {
  const workspace = await createWorkspace({ ownerId, repository, branch });
  try {
    const checkout = await checkoutGithubRepository({
      workspacePath: workspace.path,
      repository,
      branch
    });
    const resolvedPlan = plan || await deriveBuildPlan(workspace.path, repository, branch);\n    const build = await runCloudBuild({ plan: resolvedPlan, cwd: workspace.path });
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
