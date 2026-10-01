import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const DEFAULT_TTL = 30 * 60 * 1000;

function safePart(value, fallback = "workspace") {
  const text = String(value || fallback);
  return text.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || fallback;
}

export async function createWorkspace({ ownerId, repository, branch = "main", ttlMs = DEFAULT_TTL } = {}) {
  if (!ownerId) throw new Error("ownerId is required");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || "")) || String(repository).includes("..")) throw new Error("repository must be owner/name");
  const id = "ws_" + crypto.randomUUID();
  const root = path.join(process.env.BHAI_WORKSPACE_ROOT || path.join(os.tmpdir(), "bhai-core-workspaces"), safePart(ownerId), id);
  await fs.mkdir(root, { recursive: true });
  return {
    id,
    ownerId,
    repository,
    branch: safePart(branch, "main"),
    path: root,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL)).toISOString()
  };
}

export async function cleanupWorkspace(workspace) {
  if (!workspace?.path) return false;
  await fs.rm(workspace.path, { recursive: true, force: true });
  return true;
}

export async function workspaceInfo() {
  return {
    root: process.env.BHAI_WORKSPACE_ROOT || path.join(os.tmpdir(), "bhai-core-workspaces"),
    ttlMs: Number(process.env.BHAI_WORKSPACE_TTL_MS || DEFAULT_TTL)
  };
}

export async function createDeploymentWorkspace({ ownerId, deploymentId } = {}) {
  if (!ownerId || !deploymentId) throw Object.assign(new Error("ownerId and deploymentId required"), { code: "DEPLOYMENT_IDENTITY_REQUIRED", status: 400 });
  const root = process.env.BHAI_DEPLOYMENT_ROOT || path.join(os.tmpdir(), "bhai-core-deployments");
  const safeOwner = String(ownerId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeDeployment = String(deploymentId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const deploymentPath = path.join(root, safeOwner, safeDeployment);
  await fs.mkdir(deploymentPath, { recursive: true });
  return { id: deploymentId, ownerId, path: deploymentPath, persistent: true };
}
export async function removeDeploymentWorkspace(workspace) {
  if (!workspace?.path) return;
  const root = path.resolve(process.env.BHAI_DEPLOYMENT_ROOT || path.join(os.tmpdir(), "bhai-core-deployments"));
  const target = path.resolve(workspace.path);
  if (!target.startsWith(root + path.sep)) throw Object.assign(new Error("Invalid deployment workspace"), { code: "DEPLOYMENT_PATH_INVALID", status: 400 });
  await fs.rm(target, { recursive: true, force: true });
}
