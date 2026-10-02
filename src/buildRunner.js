import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_OUTPUT = 200_000;

function buildEnv(extra = {}) {
  const inherited = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV"]) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return { ...inherited, ...extra };
}

function shellCommand(command) {
  if (typeof command !== "string" || !command.trim()) throw new Error("command is required");
  if (/\b(?:rm\s+-rf|mkfs|shutdown|reboot|curl\s+.*\|\s*(?:sh|bash)|wget\s+.*\|\s*(?:sh|bash))\b|(?:;|&&|\|\||`|\$\(|>|<)/i.test(command)) {
    const error = new Error("Command rejected by build safety policy");
    error.code = "BUILD_COMMAND_REJECTED";
    error.status = 403;
    throw error;
  }
  return command.trim();
}

export async function runBuildCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT, maxOutputChars = DEFAULT_OUTPUT, env = {} } = {}) {
  const safe = shellCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-lc", safe], {
      cwd,
      env: buildEnv(env),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "", stderr = "", truncated = false;
    const append = (target, chunk) => {
      const value = target + chunk.toString();
      if (value.length <= maxOutputChars) return value;
      truncated = true;
      return value.slice(-maxOutputChars);
    };
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT));
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ command: safe, code, signal, stdout, stderr, truncated, ok: code === 0 && !signal });
    });
  });
}

export function buildRunnerInfo() {
  return {
    enabled: process.env.BHAI_BUILD_RUNNER_ENABLED === "true",
    timeoutMs: Number(process.env.BHAI_BUILD_TIMEOUT_MS || DEFAULT_TIMEOUT),
    maxOutputChars: Number(process.env.BHAI_BUILD_MAX_OUTPUT_CHARS || DEFAULT_OUTPUT)
  };
}
