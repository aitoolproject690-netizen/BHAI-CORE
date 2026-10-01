import { runBuildCommand, buildRunnerInfo } from "./buildRunner.js";

const ALLOWED_KEYS = new Set(["install","test","build","start"]);
const PHASES = ["install","test","build"];

export async function runCloudBuild({ plan, cwd }) {
  if (!plan || typeof plan !== "object") throw new Error("build plan is required");
  if (!plan.deployable) {
    const error = new Error("Build plan is not deployable");
    error.code = "BUILD_PLAN_NOT_DEPLOYABLE";
    error.status = 422;
    throw error;
  }
  if (!cwd) throw new Error("workspace cwd is required");

  const commands = plan.commands || {};
  for (const key of Object.keys(commands)) {
    if (!ALLOWED_KEYS.has(key)) {
      const error = new Error(`Build command key not allowed: ${key}`);
      error.code = "BUILD_COMMAND_KEY_REJECTED";
      error.status = 403;
      throw error;
    }
  }

  const info = buildRunnerInfo();
  if (!info.enabled) {
    const error = new Error("Local build runner is disabled");
    error.code = "BUILD_RUNNER_DISABLED";
    error.status = 503;
    throw error;
  }

  const phases = [];
  for (const phase of PHASES) {
    const command = commands[phase];
    if (!command) continue;
    const result = await runBuildCommand(command, {
      cwd,
      timeoutMs: info.timeoutMs,
      maxOutputChars: info.maxOutputChars
    });
    phases.push({ phase, ...result });
    if (!result.ok) {
      return { ok:false, status:"failed", runtime:plan.runtime, framework:plan.framework, phases };
    }
  }

  return {
    ok:true,
    status:"succeeded",
    runtime:plan.runtime,
    framework:plan.framework,
    phases,
    startCommand: commands.start || null
  };
}

export function cloudBuildInfo() {
  return {
    ...buildRunnerInfo(),
    phases: [...PHASES],
    allowedCommandKeys: [...ALLOWED_KEYS]
  };
}
