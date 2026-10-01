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
