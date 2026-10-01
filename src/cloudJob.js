import { createWorkspace, cleanupWorkspace } from "./workspace.js";
import { checkoutGithubRepository } from "./source.js";
import { runCloudBuild } from "./cloudBuild.js";

export async function executeCloudBuildJob({ ownerId, repository, branch = "main", plan } = {}) {
  const workspace = await createWorkspace({ ownerId, repository, branch });
  try {
    const checkout = await checkoutGithubRepository({
      workspacePath: workspace.path,
      repository,
      branch
    });
    const build = await runCloudBuild({ plan, cwd: workspace.path });
    return {
      status: build.ok ? "succeeded" : "failed",
      workspaceId: workspace.id,
      repository,
      branch,
      checkout: { ok: checkout.ok, path: checkout.path },
      build
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
