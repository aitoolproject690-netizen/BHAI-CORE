import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = Number(process.env.BHAI_RUNTIME_START_TIMEOUT_MS || 30000);
const MAX_OUTPUT = Number(process.env.BHAI_RUNTIME_MAX_OUTPUT_CHARS || 50000);
const ALLOWED_COMMANDS = new Set(["start"]);

function runtimeEnv(extra = {}) {
  const inherited = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "NODE_ENV"]) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return { ...inherited, ...extra };
}

function validateCommand(command) {
  if (!command || typeof command !== "string") {
    throw Object.assign(new Error("Runtime start command required"), { code: "RUNTIME_COMMAND_REQUIRED", status: 400 });
  }
  if (!ALLOWED_COMMANDS.has("start")) throw new Error("Runtime policy invalid");
  const blocked = /(rm\s+-rf|mkfs|shutdown|reboot|(?:^|[\s|&])(?:sh|bash|dash|zsh)\s+(?:-[a-z]*c\b|-[a-z]*\s+-c\b)|curl\s+[^|]*\|\s*(sh|bash)|wget\s+[^|]*\|\s*(sh|bash)|(?:;|&&|\|\||`|\$\(|>|<|[\r\n]))/i;
  if (blocked.test(command)) {
    throw Object.assign(new Error("Runtime command rejected"), { code: "RUNTIME_COMMAND_REJECTED", status: 400 });
  }
  return command;
}

export function startRuntime({ command, cwd, env = {}, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  if (process.env.BHAI_RUNTIME_ENABLED !== "true") {
    throw Object.assign(new Error("Cloud runtime is disabled"), { code: "RUNTIME_DISABLED", status: 503 });
  }
  const safeCommand = validateCommand(command);
  if (!cwd) {
    throw Object.assign(new Error("Runtime cwd required"), { code: "RUNTIME_CWD_REQUIRED", status: 400 });
  }
  const child = spawn("/bin/sh", ["-lc", safeCommand], {
    cwd,
    env: runtimeEnv(env),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  const append = (target, chunk) => (target + chunk.toString()).slice(-MAX_OUTPUT);
  child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
  child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });

  const timeout = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateProcessTree(child, "SIGTERM");
    setTimeout(() => terminateProcessTree(child, "SIGKILL"), 2000).unref();
  }, timeout);

  const ready = new Promise((resolve, reject) => {
    child.once("spawn", () => resolve({ pid: child.pid }));
    child.once("error", reject);
  });
  const exit = new Promise(resolve => child.once("close", (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, stdout, stderr, timedOut });
  }));
  return { child, ready, exit, pid: child.pid, command: safeCommand };
}

function terminateProcessTree(child, signal) {
  if (!child || child.killed) return false;
  try {
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  return true;
}

export async function stopRuntime(child, signal = "SIGTERM") {
  return terminateProcessTree(child, signal);
}

export function runtimeInfo() {
  return {
    enabled: process.env.BHAI_RUNTIME_ENABLED === "true",
    timeoutMs: DEFAULT_TIMEOUT,
    maxOutputChars: MAX_OUTPUT,
    shellPolicy: "single-command-no-shell-chaining"
  };
}

export async function healthCheck(url, { timeoutMs = 10000, expectedPort = null } = {}) {
  if (!url || typeof url !== "string") {
    throw Object.assign(new Error("Health URL required"), { code: "HEALTH_URL_REQUIRED", status: 400 });
  }
  let parsed;
  try { parsed = new URL(url); } catch {
    throw Object.assign(new Error("Invalid health URL"), { code: "HEALTH_URL_INVALID", status: 400 });
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw Object.assign(new Error("Health URL must target the local service"), { code: "HEALTH_URL_TARGET_INVALID", status: 400 });
  }
  if (expectedPort != null && Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80)) !== Number(expectedPort)) {
    throw Object.assign(new Error("Health URL port must match the service port"), { code: "HEALTH_URL_PORT_INVALID", status: 400 });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.name === "AbortError" ? "TIMEOUT" : error.message };
  } finally {
    clearTimeout(timer);
  }
}
