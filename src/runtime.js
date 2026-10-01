import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = Number(process.env.BHAI_RUNTIME_START_TIMEOUT_MS || 30000);
const MAX_OUTPUT = Number(process.env.BHAI_RUNTIME_MAX_OUTPUT_CHARS || 50000);
const ALLOWED_COMMANDS = new Set(["start"]);

function validateCommand(command) {
  if (!command || typeof command !== "string") throw Object.assign(new Error("Runtime start command required"), { code: "RUNTIME_COMMAND_REQUIRED", status: 400 });
  if (!ALLOWED_COMMANDS.has("start")) throw new Error("Runtime policy invalid");
  const blocked = /(rm\s+-rf|mkfs|shutdown|reboot|curl\s+[^|]*\|\s*(sh|bash)|wget\s+[^|]*\|\s*(sh|bash))/i;
  if (blocked.test(command)) throw Object.assign(new Error("Runtime command rejected"), { code: "RUNTIME_COMMAND_REJECTED", status: 400 });
  return command;
}

export function startRuntime({ command, cwd, env = {}, timeoutMs = DEFAULT_TIMEOUT } = {}) {
  if (process.env.BHAI_RUNTIME_ENABLED !== "true") throw Object.assign(new Error("Cloud runtime is disabled"), { code: "RUNTIME_DISABLED", status: 503 });
  const safeCommand = validateCommand(command);
  if (!cwd) throw Object.assign(new Error("Runtime cwd required"), { code: "RUNTIME_CWD_REQUIRED", status: 400 });
  const child = spawn("/bin/sh", ["-lc", safeCommand], {
    cwd,
    env: { ...process.env, ...env },
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "", stderr = "";
  const append = (target, chunk) => (target + chunk.toString()).slice(-MAX_OUTPUT);
  child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
  child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
  let timer = setTimeout(() => {}, timeoutMs);
  const ready = new Promise((resolve, reject) => {
    child.once("spawn", () => resolve({ pid: child.pid }));
    child.once("error", reject);
  });
  const exit = new Promise(resolve => child.once("close", (code, signal) => {
    clearTimeout(timer);
    resolve({ code, signal, stdout, stderr });
  }));
  return { child, ready, exit, pid: child.pid, command: safeCommand };
}

export async function stopRuntime(child, signal = "SIGTERM") {
  if (!child || child.killed) return false;
  child.kill(signal);
  return true;
}

export function runtimeInfo() {
  return { enabled: process.env.BHAI_RUNTIME_ENABLED === "true", timeoutMs: DEFAULT_TIMEOUT, maxOutputChars: MAX_OUTPUT };
}

export async function healthCheck(url, { timeoutMs = 10000 } = {}) {
  if (!url || typeof url !== "string") throw Object.assign(new Error("Health URL required"), { code: "HEALTH_URL_REQUIRED", status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error.name === "AbortError" ? "TIMEOUT" : error.message };
  } finally { clearTimeout(timer); }
}
