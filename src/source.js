import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

function validateRepository(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || "")) || String(repository).includes("..")) {
    const error = new Error("repository must be owner/name");
    error.code = "INVALID_REPOSITORY";
    error.status = 400;
    throw error;
  }
  return repository;
}

function validateBranch(branch = "main") {
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes("..")) {
    const error = new Error("invalid branch");
    error.code = "INVALID_BRANCH";
    error.status = 400;
    throw error;
  }
  return branch;
}

function runGit(args, { cwd, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", c => { stdout += c.toString(); });
    child.stderr.on("data", c => { stderr += c.toString(); });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !signal, code, signal, stdout: stdout.slice(-50000), stderr: stderr.slice(-50000) });
    });
  });
}

export async function checkoutGithubRepository({ workspacePath, repository, branch = "main" } = {}) {
  validateRepository(repository);
  validateBranch(branch);
  if (!workspacePath) throw new Error("workspacePath is required");
  await fs.mkdir(workspacePath, { recursive: true });

  const result = await runGit(
    ["clone", "--depth", "1", "--branch", branch, "--single-branch", "https://github.com/" + repository + ".git", "."],
    { cwd: workspacePath }
  );
  if (!result.ok) {
    const error = new Error(result.stderr || "git clone failed");
    error.code = "GIT_CHECKOUT_FAILED";
    error.status = 502;
    throw error;
  }
  return { ok: true, repository, branch, path: path.resolve(workspacePath) };
}

export function sourceInfo() {
  return {
    provider: "github",
    cloneMode: "shallow",
    credentials: "none-for-public-repositories"
  };
}
